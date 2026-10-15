import { CertificateInfo, TlsScanResult } from '../../scanner/scanner.types';

/** Fixed "current time" for tests, so expiry rules never depend on the real clock. */
export const NOW = new Date('2026-06-01T00:00:00.000Z');

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysFromNow = (days: number): string => new Date(NOW.getTime() + days * DAY_MS).toISOString();

export interface ScanOverrides {
  tls?: Partial<TlsScanResult['tls']>;
  trust?: Partial<TlsScanResult['trust']>;
  certificate?: Partial<CertificateInfo>;
}

/**
 * Builds a scan of an "ideal" server that triggers no rule at all: a trusted post-quantum (ML-DSA)
 * certificate valid for another year, TLS 1.3 and hybrid ML-KEM key exchange.
 * Each test then changes only the one thing it is about.
 */
export function makeScan(overrides: ScanOverrides = {}): TlsScanResult {
  return {
    target: { host: 'example.test', port: 443 },
    scannedAt: NOW.toISOString(),
    durationMs: 42,
    remoteAddress: '192.0.2.10',
    tls: {
      protocol: 'TLSv1.3',
      cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384' },
      keyExchange: { type: null, name: null, size: null },
      postQuantumKeyExchange: true,
      ...overrides.tls,
    },
    trust: { authorized: true, error: null, ...overrides.trust },
    certificate: {
      subject: 'CN=example.test',
      issuer: 'CN=Example PQ CA',
      subjectAltNames: ['example.test'],
      serialNumber: '01',
      validFrom: daysFromNow(-30),
      validTo: daysFromNow(365),
      publicKey: { algorithm: 'ML-DSA-65', size: null, oid: '2.16.840.1.101.3.4.3.18' },
      signatureAlgorithm: { name: 'ML-DSA-65', hash: null, oid: '2.16.840.1.101.3.4.3.18' },
      selfSigned: false,
      fingerprintSha256: 'AA:BB',
      ...overrides.certificate,
    },
  };
}

/** Common classical key used by many tests: a 2048-bit RSA key signed with SHA-256. */
export const RSA_2048 = {
  publicKey: { algorithm: 'RSA' as const, size: 2048, oid: '1.2.840.113549.1.1.1' },
  signatureAlgorithm: { name: 'sha256WithRSAEncryption', hash: 'SHA-256', oid: '1.2.840.113549.1.1.11' },
};
