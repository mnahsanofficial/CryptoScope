import { Inject, Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import * as tls from 'node:tls';
import { parseCertificate } from './certificate-parser';
import { createLimiter } from './concurrency';
import { ScanError, toScanError } from './scan-error';
import { formatTarget, parseTarget } from './scan-target';
import { KeyExchangeInfo, ScanOutcome, ScanTarget, TlsScanResult } from './scanner.types';
import { Resolver, TargetPolicy } from './target-policy';

export interface ScannerOptions {
  /** Max time for DNS + TCP connect + TLS handshake, per connection. */
  timeoutMs: number;
  /** Max number of hosts scanned at the same time. */
  concurrency: number;
  /** Run a second handshake to test for hybrid post-quantum key exchange. */
  probePostQuantum: boolean;
  /** Allow private/loopback/reserved addresses. Off in production (SSRF protection). */
  allowPrivateTargets: boolean;
  /** For tests: replace DNS resolution. */
  resolver?: Resolver;
}

export const SCANNER_OPTIONS = Symbol('SCANNER_OPTIONS');

/** Hybrid key exchange: classical X25519 + ML-KEM-768 (FIPS 203). Supported by OpenSSL 3.5+. */
const HYBRID_PQ_GROUP = 'X25519MLKEM768';

/**
 * A scanner must be able to *observe* weak servers, so we allow legacy protocols and ciphers
 * that a normal client would refuse. OpenSSL 3 disables TLS 1.0/1.1 unless the security level is 0.
 * This is safe here because we never send any data over these connections.
 */
const PERMISSIVE_CLIENT_OPTIONS: tls.ConnectionOptions = {
  minVersion: 'TLSv1',
  ciphers: 'DEFAULT:@SECLEVEL=0',
  // Don't abort on bad certificates: we want to inspect them. Trust is recorded in `authorized`.
  rejectUnauthorized: false,
};

interface HandshakeSnapshot {
  protocol: string;
  cipher: { name: string; standardName: string };
  keyExchange: KeyExchangeInfo;
  authorized: boolean;
  authorizationError: string | null;
  remoteAddress: string | null;
  certificateDer: Buffer;
}

@Injectable()
export class TlsScannerService {
  private readonly logger = new Logger(TlsScannerService.name);
  private readonly policy: TargetPolicy;

  constructor(@Inject(SCANNER_OPTIONS) private readonly options: ScannerOptions) {
    this.policy = new TargetPolicy(options.allowPrivateTargets, options.resolver);
  }

  /**
   * Scans many targets in parallel (bounded by `concurrency`).
   * Never throws: every target gets an outcome, in the same order as the input.
   */
  async scanMany(inputs: readonly string[]): Promise<ScanOutcome[]> {
    const limit = createLimiter(this.options.concurrency);

    // allSettled (not all): one failing host must not discard the results of the others.
    const settled = await Promise.allSettled(
      inputs.map((input) =>
        limit(async () => {
          const target = parseTarget(input);
          return this.scan(target);
        }),
      ),
    );

    return settled.map((outcome, i): ScanOutcome => {
      if (outcome.status === 'fulfilled') {
        return { target: outcome.value.target, status: 'success', result: outcome.value };
      }
      const error = toScanError(outcome.reason);
      const target = safeParseTarget(inputs[i]);
      this.logger.warn(`Scan failed for ${inputs[i]}: [${error.code}] ${error.message}`);
      return { target, status: 'failed', error: { code: error.code, message: error.message } };
    });
  }

  /** Scans one target. Throws ScanError on failure. */
  async scan(target: ScanTarget): Promise<TlsScanResult> {
    const started = Date.now();
    // Resolve + SSRF check once, then connect to that exact IP for every handshake.
    const address = await this.policy.resolveAllowedAddress(target.host);
    const handshake = await this.handshake(target, address, PERMISSIVE_CLIENT_OPTIONS, snapshot);

    // Hybrid PQ key exchange only exists in TLS 1.3.
    const postQuantumKeyExchange =
      this.options.probePostQuantum && handshake.protocol === 'TLSv1.3'
        ? await this.supportsHybridPqKeyExchange(target, address)
        : null;

    return {
      target,
      scannedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      remoteAddress: handshake.remoteAddress,
      tls: {
        protocol: handshake.protocol,
        cipher: handshake.cipher,
        keyExchange: handshake.keyExchange,
        postQuantumKeyExchange,
      },
      trust: {
        authorized: handshake.authorized,
        error: handshake.authorizationError,
      },
      certificate: parseCertificate(handshake.certificateDer),
    };
  }

  /**
   * Offers ONLY the hybrid group. If the handshake succeeds, the server supports it.
   * Returns null when we can't tell (timeout, or the local OpenSSL doesn't know the group).
   */
  private async supportsHybridPqKeyExchange(target: ScanTarget, address: string): Promise<boolean | null> {
    try {
      await this.handshake(
        target,
        address,
        { ...PERMISSIVE_CLIENT_OPTIONS, minVersion: 'TLSv1.3', ecdhCurve: HYBRID_PQ_GROUP },
        () => true,
      );
      return true;
    } catch (err) {
      const error = toScanError(err);
      if (error.code === 'TLS_HANDSHAKE_FAILED') return false;
      this.logger.debug(`PQ probe inconclusive for ${formatTarget(target)}: ${error.message}`);
      return null;
    }
  }

  /**
   * Opens a TLS connection, runs `onSecure` once the handshake completes, then closes the socket.
   * Exactly one of resolve/reject is called, and the socket is always destroyed.
   */
  private handshake<T>(
    target: ScanTarget,
    address: string,
    options: tls.ConnectionOptions,
    onSecure: (socket: tls.TLSSocket) => T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = tls.connect({
        ...options,
        host: address, // the IP we checked, never the name again (prevents DNS rebinding)
        port: target.port,
        // SNI tells the server which certificate to send. It must be a hostname, never an IP.
        servername: isIP(target.host) ? undefined : target.host,
      });

      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        callback();
      };

      const timer = setTimeout(
        () =>
          finish(() =>
            reject(new ScanError('TIMEOUT', `No TLS handshake with ${formatTarget(target)} within ${this.options.timeoutMs}ms`)),
          ),
        this.options.timeoutMs,
      );

      socket.once('secureConnect', () => {
        try {
          const value = onSecure(socket);
          finish(() => resolve(value));
        } catch (err) {
          finish(() => reject(toScanError(err)));
        }
      });

      // `on`, not `once`: a socket can emit more than one error, and an unhandled one would crash the process.
      socket.on('error', (err) => finish(() => reject(toScanError(err))));
    });
  }
}

function snapshot(socket: tls.TLSSocket): HandshakeSnapshot {
  const certificate = socket.getPeerCertificate(false);
  if (!certificate || !certificate.raw) {
    throw new ScanError('NO_CERTIFICATE', 'Server did not present a certificate');
  }

  const cipher = socket.getCipher();
  const authorizationError = socket.authorizationError as unknown as Error | string | null;

  return {
    protocol: socket.getProtocol() ?? 'unknown',
    cipher: { name: cipher.name, standardName: cipher.standardName },
    keyExchange: describeKeyExchange(socket.getEphemeralKeyInfo()),
    authorized: socket.authorized,
    // Node types this as Error, but at runtime it's a code string like "CERT_HAS_EXPIRED".
    authorizationError: authorizationError ? String(authorizationError) : null,
    remoteAddress: socket.remoteAddress ?? null,
    certificateDer: certificate.raw,
  };
}

/** Node returns {} for groups it can't describe, which includes hybrid PQ groups like X25519MLKEM768. */
function describeKeyExchange(info: tls.EphemeralKeyInfo | object | null): KeyExchangeInfo {
  const known = info as Partial<tls.EphemeralKeyInfo> | null;
  return {
    type: known?.type ?? null,
    name: known?.name ?? null,
    size: known?.size ?? null,
  };
}

function safeParseTarget(input: string): ScanTarget {
  try {
    return parseTarget(input);
  } catch {
    return { host: input, port: 0 };
  }
}
