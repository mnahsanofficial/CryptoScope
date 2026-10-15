import { AlgorithmUnavailableError, CryptoProvider, SignatureAlgorithm, SIGNATURE_ALGORITHMS } from './crypto-provider';
import { EcdsaProvider, RsaProvider } from './providers/classical.providers';
import { HybridProvider } from './providers/hybrid.provider';
import { MlDsaProvider } from './providers/ml-dsa.provider';

/**
 * Knows every provider by its algorithm identifier.
 *  - The ACTIVE provider (from config) is used to create new signatures.
 *  - ANY registered provider can verify, picked by the identifier stored with the signature.
 * That second point is what makes migration possible: after switching to ML-DSA, signatures made
 * earlier with ECDSA still verify, and both can coexist during the transition.
 * Adding a new algorithm = one new class + one line here. No caller changes.
 */
export class CryptoProviderRegistry {
  private readonly providers = new Map<SignatureAlgorithm, CryptoProvider>();

  constructor(providers: CryptoProvider[] = defaultProviders()) {
    for (const p of providers) this.providers.set(p.algorithm, p);
  }

  get(algorithm: SignatureAlgorithm): CryptoProvider {
    const provider = this.providers.get(algorithm);
    if (!provider) throw new Error(`Unknown signature algorithm: ${algorithm}`);
    return provider;
  }

  list(): CryptoProvider[] {
    return [...this.providers.values()];
  }

  /** Used at startup: a misconfigured or unsupported algorithm stops the app instead of failing later. */
  resolveActive(configured: string): CryptoProvider {
    if (!(SIGNATURE_ALGORITHMS as readonly string[]).includes(configured)) {
      throw new Error(`CRYPTO_SIGNATURE_ALGORITHM must be one of ${SIGNATURE_ALGORITHMS.join(', ')}, got "${configured}"`);
    }
    const provider = this.get(configured as SignatureAlgorithm);
    if (!provider.isAvailable()) {
      throw new AlgorithmUnavailableError(provider.algorithm, `not supported by this runtime (Node.js ${process.version})`);
    }
    return provider;
  }
}

export function defaultProviders(): CryptoProvider[] {
  const ecdsa = new EcdsaProvider();
  const mlDsa = new MlDsaProvider();
  return [new RsaProvider(), ecdsa, mlDsa, new HybridProvider('HYBRID-ECDSA-P256+ML-DSA-65', ecdsa, mlDsa)];
}
