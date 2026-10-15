export interface ScanTarget {
  host: string;
  port: number;
}

/** Normalised algorithm families. Anything we can't identify is reported as 'unknown' with its OID. */
export type KeyAlgorithm =
  | 'RSA'
  | 'EC'
  | 'Ed25519'
  | 'Ed448'
  | 'ML-DSA-44'
  | 'ML-DSA-65'
  | 'ML-DSA-87'
  | 'unknown';

export interface PublicKeyInfo {
  algorithm: KeyAlgorithm;
  /** Key size in bits (RSA modulus length, EC curve size). Null when not meaningful, e.g. ML-DSA. */
  size: number | null;
  /** EC named curve, e.g. prime256v1 (P-256). */
  curve?: string;
  oid: string;
}

export interface SignatureAlgorithmInfo {
  /** Human-readable name, e.g. sha256WithRSAEncryption, ecdsa-with-SHA256, ML-DSA-65. */
  name: string;
  /** Hash used by the signature, when it has a separate one (RSA/ECDSA). */
  hash: string | null;
  oid: string;
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  subjectAltNames: string[];
  serialNumber: string;
  validFrom: string; // ISO 8601
  validTo: string; // ISO 8601
  publicKey: PublicKeyInfo;
  signatureAlgorithm: SignatureAlgorithmInfo;
  /** Subject == issuer and the certificate verifies with its own public key. */
  selfSigned: boolean;
  fingerprintSha256: string;
}

export interface KeyExchangeInfo {
  /** e.g. ECDH / DH, as reported by OpenSSL. Null when Node can't describe the group (hybrid PQ groups). */
  type: string | null;
  /** e.g. X25519, prime256v1. */
  name: string | null;
  size: number | null;
}

export interface TlsScanResult {
  target: ScanTarget;
  scannedAt: string;
  durationMs: number;
  remoteAddress: string | null;
  tls: {
    protocol: string; // TLSv1, TLSv1.1, TLSv1.2, TLSv1.3
    cipher: { name: string; standardName: string };
    keyExchange: KeyExchangeInfo;
    /**
     * Does the server accept the hybrid post-quantum group X25519MLKEM768?
     * true/false from a dedicated probe, null if the probe couldn't run (e.g. not TLS 1.3, or timed out).
     */
    postQuantumKeyExchange: boolean | null;
  };
  /** Result of normal chain validation. We still connect to untrusted servers so we can inspect them. */
  trust: {
    authorized: boolean;
    error: string | null; // e.g. CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT
  };
  certificate: CertificateInfo;
}

export type ScanErrorCode =
  | 'INVALID_TARGET'
  | 'DNS_NOT_FOUND'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_RESET'
  | 'HOST_UNREACHABLE'
  | 'TIMEOUT'
  | 'TLS_HANDSHAKE_FAILED'
  | 'NO_CERTIFICATE'
  | 'UNKNOWN';

export type ScanOutcome =
  | { target: ScanTarget; status: 'success'; result: TlsScanResult }
  | { target: ScanTarget; status: 'failed'; error: { code: ScanErrorCode; message: string } };
