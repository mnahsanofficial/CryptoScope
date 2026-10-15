import { generateKeyPairSync } from 'node:crypto';
import { AlgorithmUnavailableError, CryptoProvider, KeyPair } from '../crypto-provider';
import { generatePemKeyPair, signAsync, verifyAsync } from './node-crypto';

/**
 * ML-DSA-65 (FIPS 204, formerly CRYSTALS-Dilithium): NIST's main post-quantum signature standard.
 * Its security rests on lattice problems (Module-LWE / Module-SIS) that Shor's algorithm doesn't solve.
 * Security category 3 (~AES-192). The cost: much larger keys and signatures than ECDSA
 * (public key ~1.9 KB vs 91 B, signature ~3.3 KB vs ~72 B).
 *
 * It plugs in exactly like the classical providers: same interface, different key type.
 * Node.js exposes ML-DSA from version 24 (built on OpenSSL 3.5). On older runtimes this provider
 * reports itself unavailable instead of failing in the middle of a request. Other ways to get ML-DSA:
 * liboqs / oqs-provider, a cloud KMS or HSM that supports it, or a vetted library like @noble/post-quantum.
 */
export class MlDsaProvider implements CryptoProvider {
  readonly algorithm = 'ML-DSA-65' as const;
  readonly family = 'Lattice' as const;
  readonly quantumSafe = true;
  readonly standard = 'FIPS 204 (ML-DSA, parameter set ML-DSA-65)';

  private static readonly keyType = 'ml-dsa-65';
  private supported: boolean | undefined;

  /** Detected once, by actually trying to create a key: the honest answer for this runtime. */
  isAvailable(): boolean {
    if (this.supported === undefined) {
      try {
        generateKeyPairSync(MlDsaProvider.keyType as 'ed25519'); // cast: older @types/node don't list ML-DSA yet
        this.supported = true;
      } catch {
        this.supported = false;
      }
    }
    return this.supported;
  }

  // async: an unavailable algorithm becomes a rejected promise, like any other failure, not a sync throw.
  async generateKeyPair(): Promise<KeyPair> {
    this.assertAvailable();
    return generatePemKeyPair(MlDsaProvider.keyType);
  }

  async sign(message: Buffer, privateKeyPem: string): Promise<Buffer> {
    this.assertAvailable();
    return signAsync(null, message, privateKeyPem); // ML-DSA hashes internally: no separate digest
  }

  verify(message: Buffer, signature: Buffer, publicKeyPem: string): Promise<boolean> {
    if (!this.isAvailable()) return Promise.resolve(false);
    return verifyAsync(null, message, publicKeyPem, signature);
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new AlgorithmUnavailableError(this.algorithm, `this Node.js ${process.version} has no ML-DSA support (needs Node.js 24+ with OpenSSL 3.5)`);
    }
  }
}
