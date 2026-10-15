import { BadRequestException, Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AlgorithmUnavailableError, CryptoProvider, SignatureAlgorithm } from './crypto-provider';
import { CryptoProviderRegistry } from './crypto-provider.registry';

export const ACTIVE_CRYPTO_PROVIDER = Symbol('ACTIVE_CRYPTO_PROVIDER');

/** A signature that carries everything needed to verify it later: which algorithm and which key. */
export interface SignedMessage {
  algorithm: SignatureAlgorithm;
  keyId: string;
  signature: string; // base64
  publicKey: string; // PEM
  quantumSafe: boolean;
  signatureBytes: number;
  signedAt: string;
}

export interface VerifyInput {
  message: string;
  algorithm: SignatureAlgorithm;
  signature: string; // base64
  keyId?: string;
  publicKey?: string;
}

interface StoredKey {
  keyId: string;
  publicKey: string;
  privateKey: string;
}

export interface ProviderInfo {
  algorithm: SignatureAlgorithm;
  family: CryptoProvider['family'];
  quantumSafe: boolean;
  standard: string;
  available: boolean;
  active: boolean;
  /** Measured on this machine (first call only, then cached). Null when the algorithm is unavailable. */
  measured: { publicKeyBytes: number; signatureBytes: number; signMs: number; verifyMs: number } | null;
}

/** Bytes of the DER inside one or more PEM blocks (what actually goes over the wire / into a certificate). */
const derBytes = (pem: string): number =>
  (pem.match(/-----BEGIN [A-Z ]+-----([\s\S]+?)-----END/g) ?? [])
    .map((block) => Buffer.from(block.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''), 'base64').length)
    .reduce((a, b) => a + b, 0);

/**
 * The only thing application code talks to. It never names an algorithm: it signs with whatever
 * provider is configured, and verifies with whatever provider the signature says it was made with.
 *
 * Keys: one key pair per algorithm, generated on first use and kept in memory. Fine for a demo; a real
 * system keeps private keys in a KMS or HSM, persists public keys, and rotates them (the keyId supports that).
 */
@Injectable()
export class SigningService {
  private readonly keys = new Map<SignatureAlgorithm, Promise<StoredKey>>();
  private readonly publicKeysById = new Map<string, string>();
  private readonly measurements = new Map<SignatureAlgorithm, Promise<ProviderInfo['measured']>>();

  constructor(
    private readonly registry: CryptoProviderRegistry,
    @Inject(ACTIVE_CRYPTO_PROVIDER) private readonly active: CryptoProvider,
  ) {}

  get activeAlgorithm(): SignatureAlgorithm {
    return this.active.algorithm;
  }

  /** Signs with the configured provider (or an explicitly requested one, for demos and migrations). */
  async sign(message: string, algorithm?: SignatureAlgorithm): Promise<SignedMessage> {
    const provider = algorithm ? this.registry.get(algorithm) : this.active;
    try {
      const key = await this.keyFor(provider);
      const signature = await provider.sign(Buffer.from(message, 'utf8'), key.privateKey);
      return {
        algorithm: provider.algorithm,
        keyId: key.keyId,
        signature: signature.toString('base64'),
        publicKey: key.publicKey,
        quantumSafe: provider.quantumSafe,
        signatureBytes: signature.length,
        signedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof AlgorithmUnavailableError) throw new NotImplementedException(err.message);
      throw err;
    }
  }

  /** Verifies with the provider named IN THE SIGNATURE, not the active one: old signatures stay verifiable. */
  async verify(input: VerifyInput): Promise<{ valid: boolean; algorithm: SignatureAlgorithm; quantumSafe: boolean }> {
    const provider = this.registry.get(input.algorithm);
    if (!provider.isAvailable()) {
      throw new NotImplementedException(`${provider.algorithm} is not supported by this runtime`);
    }
    const publicKey = input.publicKey ?? (input.keyId ? this.publicKeysById.get(input.keyId) : undefined);
    if (!publicKey) {
      throw new BadRequestException('Provide the publicKey, or the keyId of a key known to this server');
    }
    const valid = await provider.verify(Buffer.from(input.message, 'utf8'), Buffer.from(input.signature, 'base64'), publicKey);
    return { valid, algorithm: provider.algorithm, quantumSafe: provider.quantumSafe };
  }

  async describeProviders(): Promise<ProviderInfo[]> {
    return Promise.all(
      this.registry.list().map(async (p) => ({
        algorithm: p.algorithm,
        family: p.family,
        quantumSafe: p.quantumSafe,
        standard: p.standard,
        available: p.isAvailable(),
        active: p.algorithm === this.active.algorithm,
        measured: p.isAvailable() ? await this.measure(p) : null,
      })),
    );
  }

  /** One key per algorithm. Caching the promise means concurrent first requests don't create two keys. */
  private keyFor(provider: CryptoProvider): Promise<StoredKey> {
    let key = this.keys.get(provider.algorithm);
    if (!key) {
      key = provider.generateKeyPair().then((pair) => {
        const keyId = createHash('sha256').update(pair.publicKey).digest('hex').slice(0, 16);
        this.publicKeysById.set(keyId, pair.publicKey);
        return { keyId, ...pair };
      });
      key.catch(() => this.keys.delete(provider.algorithm)); // don't cache a failure
      this.keys.set(provider.algorithm, key);
    }
    return key;
  }

  /** Average sign/verify time over a few runs plus key and signature sizes: makes the trade-offs visible. */
  private measure(provider: CryptoProvider): Promise<ProviderInfo['measured']> {
    let result = this.measurements.get(provider.algorithm);
    if (!result) {
      result = (async () => {
        const key = await this.keyFor(provider);
        const message = Buffer.from('CryptoScope benchmark message');
        const runs = 5;
        let signature: Buffer = Buffer.alloc(0);
        let signNs = 0n;
        let verifyNs = 0n;
        for (let i = 0; i < runs; i++) {
          const t0 = process.hrtime.bigint();
          signature = await provider.sign(message, key.privateKey);
          const t1 = process.hrtime.bigint();
          await provider.verify(message, signature, key.publicKey);
          verifyNs += process.hrtime.bigint() - t1;
          signNs += t1 - t0;
        }
        const ms = (ns: bigint) => Math.round(Number(ns / BigInt(runs)) / 10_000) / 100;
        return { publicKeyBytes: derBytes(key.publicKey), signatureBytes: signature.length, signMs: ms(signNs), verifyMs: ms(verifyNs) };
      })();
      this.measurements.set(provider.algorithm, result);
    }
    return result;
  }
}
