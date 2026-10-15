/**
 * Crypto-agility: application code signs and verifies through this interface and never names an
 * algorithm. Which algorithm is used is a configuration decision (CRYPTO_SIGNATURE_ALGORITHM),
 * so moving from RSA/ECDSA to a post-quantum algorithm is a config change, not a code change.
 */

export const SIGNATURE_ALGORITHMS = [
  'RSA-PSS-3072-SHA256',
  'ECDSA-P256-SHA256',
  'ML-DSA-65',
  'HYBRID-ECDSA-P256+ML-DSA-65',
] as const;
export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

export interface KeyPair {
  /** SubjectPublicKeyInfo, PEM. For hybrids: the component PEM blocks one after another. */
  publicKey: string;
  /** PKCS#8, PEM. */
  privateKey: string;
}

export interface CryptoProvider {
  /** Stable identifier stored next to every signature, so verifiers know which provider to use. */
  readonly algorithm: SignatureAlgorithm;
  readonly family: 'RSA' | 'ECC' | 'Lattice' | 'Hybrid';
  /** True if the scheme resists attacks by a large quantum computer (Shor's algorithm). */
  readonly quantumSafe: boolean;
  /** The standard that defines the scheme. */
  readonly standard: string;

  /** Whether this runtime can use the algorithm (e.g. ML-DSA needs Node.js 24+). */
  isAvailable(): boolean;
  generateKeyPair(): Promise<KeyPair>;
  sign(message: Buffer, privateKeyPem: string): Promise<Buffer>;
  /** Returns false (never throws) for a wrong, tampered or malformed signature. */
  verify(message: Buffer, signature: Buffer, publicKeyPem: string): Promise<boolean>;
}

/** Thrown when a configured or requested algorithm can't run on this runtime. */
export class AlgorithmUnavailableError extends Error {
  constructor(
    readonly algorithm: SignatureAlgorithm,
    reason: string,
  ) {
    super(`${algorithm} is not available: ${reason}`);
    this.name = 'AlgorithmUnavailableError';
  }
}
