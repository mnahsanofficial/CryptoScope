import { KeyAlgorithm } from './scanner.types';

/** Signature algorithm OIDs we recognise, with the hash they use. */
export const SIGNATURE_ALGORITHMS: Record<string, { name: string; hash: string | null }> = {
  // RSA PKCS#1 v1.5 (RFC 8017)
  '1.2.840.113549.1.1.4': { name: 'md5WithRSAEncryption', hash: 'MD5' },
  '1.2.840.113549.1.1.5': { name: 'sha1WithRSAEncryption', hash: 'SHA-1' },
  '1.2.840.113549.1.1.11': { name: 'sha256WithRSAEncryption', hash: 'SHA-256' },
  '1.2.840.113549.1.1.12': { name: 'sha384WithRSAEncryption', hash: 'SHA-384' },
  '1.2.840.113549.1.1.13': { name: 'sha512WithRSAEncryption', hash: 'SHA-512' },
  // RSA-PSS: the hash lives in the parameters, which we don't decode
  '1.2.840.113549.1.1.10': { name: 'RSASSA-PSS', hash: null },
  // ECDSA (RFC 5758)
  '1.2.840.10045.4.1': { name: 'ecdsa-with-SHA1', hash: 'SHA-1' },
  '1.2.840.10045.4.3.2': { name: 'ecdsa-with-SHA256', hash: 'SHA-256' },
  '1.2.840.10045.4.3.3': { name: 'ecdsa-with-SHA384', hash: 'SHA-384' },
  '1.2.840.10045.4.3.4': { name: 'ecdsa-with-SHA512', hash: 'SHA-512' },
  // EdDSA (RFC 8410): hashing is built into the algorithm
  '1.3.101.112': { name: 'Ed25519', hash: null },
  '1.3.101.113': { name: 'Ed448', hash: null },
  // ML-DSA, the NIST post-quantum signature standard (FIPS 204)
  '2.16.840.1.101.3.4.3.17': { name: 'ML-DSA-44', hash: null },
  '2.16.840.1.101.3.4.3.18': { name: 'ML-DSA-65', hash: null },
  '2.16.840.1.101.3.4.3.19': { name: 'ML-DSA-87', hash: null },
};

/** Public key algorithm OIDs (from SubjectPublicKeyInfo). */
export const PUBLIC_KEY_ALGORITHMS: Record<string, KeyAlgorithm> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.10': 'RSA', // RSA-PSS key
  '1.2.840.10045.2.1': 'EC',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
};

/** Bit size of common named EC curves (OpenSSL names). */
export const EC_CURVE_BITS: Record<string, number> = {
  prime256v1: 256,
  secp384r1: 384,
  secp521r1: 521,
  secp256k1: 256,
};
