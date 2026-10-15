import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { ScanOutcome } from './scanner.types';
import { ScannerOptions, TlsScannerService } from './tls-scanner.service';

/**
 * These tests start real TLS servers on 127.0.0.1, so they exercise the actual handshake code
 * without depending on the internet. The server uses a self-signed RSA-2048 test certificate.
 */
const fixtures = join(__dirname, '__fixtures__');
const key = readFileSync(join(fixtures, 'rsa2048-sha256.key'));
const cert = readFileSync(join(fixtures, 'rsa2048-sha256.crt'));

const servers: Server[] = [];
const openSockets = new Set<Socket>();

async function listen(server: Server): Promise<number> {
  servers.push(server);
  // server.close() waits for open connections, so remember them and destroy them in afterEach.
  server.on('connection', (socket: Socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function startTlsServer(options: tls.TlsOptions = {}): Promise<number> {
  const server = tls.createServer({ key, cert, ...options }, (socket) => socket.end());
  // A scanner hanging up mid-handshake is normal; don't let it crash the test.
  server.on('tlsClientError', () => undefined);
  return listen(server);
}

/** Accepts TCP connections but never speaks TLS: the scanner must time out. */
function startSilentServer(): Promise<number> {
  return listen(createServer(() => undefined));
}

/** Finds a port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function expectSuccess(outcome: ScanOutcome) {
  if (outcome.status !== 'success') {
    throw new Error(`Expected success, got ${outcome.error.code}: ${outcome.error.message}`);
  }
  return outcome.result;
}

function expectFailure(outcome: ScanOutcome) {
  if (outcome.status !== 'failed') throw new Error('Expected a failed outcome');
  return outcome.error;
}

describe('TlsScannerService', () => {
  // The test servers listen on 127.0.0.1, so private targets must be allowed here (see the SSRF tests below).
  const options: ScannerOptions = { timeoutMs: 1_000, concurrency: 5, probePostQuantum: true, allowPrivateTargets: true };
  let scanner: TlsScannerService;

  beforeAll(() => Logger.overrideLogger(false)); // failures below are expected; keep test output clean
  afterAll(() => Logger.overrideLogger(['log', 'error', 'warn']));

  beforeEach(() => {
    scanner = new TlsScannerService(options);
  });

  afterEach(async () => {
    openSockets.forEach((socket) => socket.destroy());
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('reads protocol, cipher and certificate details from a TLS 1.3 server', async () => {
    const port = await startTlsServer();

    const [outcome] = await scanner.scanMany([`127.0.0.1:${port}`]);
    const result = expectSuccess(outcome);

    expect(result.target).toEqual({ host: '127.0.0.1', port });
    expect(result.tls.protocol).toBe('TLSv1.3');
    expect(result.tls.cipher.name).toMatch(/^TLS_/);
    expect(result.certificate.publicKey).toMatchObject({ algorithm: 'RSA', size: 2048 });
    expect(result.certificate.signatureAlgorithm.name).toBe('sha256WithRSAEncryption');
    expect(result.remoteAddress).toBe('127.0.0.1');
  });

  it('still inspects an untrusted (self-signed) certificate and records why it is untrusted', async () => {
    const port = await startTlsServer();

    const result = expectSuccess((await scanner.scanMany([`127.0.0.1:${port}`]))[0]);

    expect(result.trust).toEqual({ authorized: false, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    expect(result.certificate.selfSigned).toBe(true);
  });

  it('detects a legacy TLS 1.0 server', async () => {
    const port = await startTlsServer({ minVersion: 'TLSv1', maxVersion: 'TLSv1', ciphers: 'DEFAULT:@SECLEVEL=0' });

    const result = expectSuccess((await scanner.scanMany([`127.0.0.1:${port}`]))[0]);

    expect(result.tls.protocol).toBe('TLSv1');
    expect(result.tls.postQuantumKeyExchange).toBeNull(); // the PQ probe only applies to TLS 1.3
  });

  it('reports hybrid post-quantum key exchange support', async () => {
    const pqPort = await startTlsServer({ ecdhCurve: 'X25519MLKEM768:X25519' });
    const classicalPort = await startTlsServer({ ecdhCurve: 'X25519' });

    const [pq, classical] = await scanner.scanMany([`127.0.0.1:${pqPort}`, `127.0.0.1:${classicalPort}`]);

    expect(expectSuccess(pq).tls.postQuantumKeyExchange).toBe(true);
    expect(expectSuccess(classical).tls.postQuantumKeyExchange).toBe(false);
    expect(expectSuccess(classical).tls.keyExchange).toEqual({ type: 'ECDH', name: 'X25519', size: 253 });
  });

  it('times out on a server that never completes the handshake', async () => {
    const port = await startSilentServer();
    const fast = new TlsScannerService({ ...options, timeoutMs: 200 });

    const started = Date.now();
    const error = expectFailure((await fast.scanMany([`127.0.0.1:${port}`]))[0]);

    expect(error.code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reports a refused connection', async () => {
    const port = await closedPort();

    const error = expectFailure((await scanner.scanMany([`127.0.0.1:${port}`]))[0]);

    expect(error.code).toBe('CONNECTION_REFUSED');
  });

  it('reports DNS failures (.invalid never resolves, RFC 2606)', async () => {
    const error = expectFailure((await scanner.scanMany(['does-not-exist.invalid']))[0]);

    expect(error.code).toBe('DNS_NOT_FOUND');
  });

  it('returns one outcome per input, in input order, when some targets fail', async () => {
    const goodPort = await startTlsServer();
    const badPort = await closedPort();

    const outcomes = await scanner.scanMany([
      `127.0.0.1:${goodPort}`,
      'not a hostname',
      `127.0.0.1:${badPort}`,
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(['success', 'failed', 'failed']);
    expect(expectFailure(outcomes[1]).code).toBe('INVALID_TARGET');
    expect(expectFailure(outcomes[2]).code).toBe('CONNECTION_REFUSED');
  });
});
