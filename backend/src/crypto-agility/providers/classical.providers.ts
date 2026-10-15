import { constants } from 'node:crypto';
import { CryptoProvider, KeyPair } from '../crypto-provider';
import { generatePemKeyPair, signAsync, verifyAsync } from './node-crypto';

/**
 * RSA-PSS with a 3072-bit key and SHA-256 (RFC 8017). 3072 bits ~ 128-bit classical security (NIST SP 800-57).
 * PSS (randomised padding with a security proof) is preferred over the older PKCS#1 v1.5 padding.
 * Broken by Shor's algorithm on a large quantum computer: NOT quantum-safe.
 */
export class RsaProvider implements CryptoProvider {
  readonly algorithm = 'RSA-PSS-3072-SHA256' as const;
  readonly family = 'RSA' as const;
  readonly quantumSafe = false;
  readonly standard = 'RFC 8017 (PKCS #1 v2.2, RSASSA-PSS)';

  private readonly padding = {
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST, // salt as long as the hash (32 bytes)
  };

  isAvailable(): boolean {
    return true;
  }

  generateKeyPair(): Promise<KeyPair> {
    return generatePemKeyPair('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
  }

  sign(message: Buffer, privateKeyPem: string): Promise<Buffer> {
    return signAsync('sha256', message, { key: privateKeyPem, ...this.padding });
  }

  verify(message: Buffer, signature: Buffer, publicKeyPem: string): Promise<boolean> {
    return verifyAsync('sha256', message, { key: publicKeyPem, ...this.padding }, signature);
  }
}

/**
 * ECDSA on NIST P-256 with SHA-256 (FIPS 186-5): ~128-bit classical security with much smaller keys
 * and signatures than RSA. Also broken by Shor's algorithm: NOT quantum-safe.
 */
export class EcdsaProvider implements CryptoProvider {
  readonly algorithm = 'ECDSA-P256-SHA256' as const;
  readonly family = 'ECC' as const;
  readonly quantumSafe = false;
  readonly standard = 'FIPS 186-5 (ECDSA, curve P-256)';

  isAvailable(): boolean {
    return true;
  }

  generateKeyPair(): Promise<KeyPair> {
    return generatePemKeyPair('ec', { namedCurve: 'P-256' });
  }

  sign(message: Buffer, privateKeyPem: string): Promise<Buffer> {
    return signAsync('sha256', message, { key: privateKeyPem, dsaEncoding: 'der' });
  }

  verify(message: Buffer, signature: Buffer, publicKeyPem: string): Promise<boolean> {
    return verifyAsync('sha256', message, { key: publicKeyPem, dsaEncoding: 'der' }, signature);
  }
}
