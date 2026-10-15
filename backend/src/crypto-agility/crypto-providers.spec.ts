import { AlgorithmUnavailableError, CryptoProvider } from './crypto-provider';
import { CryptoProviderRegistry } from './crypto-provider.registry';
import { EcdsaProvider, RsaProvider } from './providers/classical.providers';
import { HybridProvider } from './providers/hybrid.provider';
import { MlDsaProvider } from './providers/ml-dsa.provider';

const message = Buffer.from('Quantum-safe migration plan v1');
const mlDsa = new MlDsaProvider();
const pqAvailable = mlDsa.isAvailable(); // true on Node.js 24+, false on 22

/** The same contract tests for EVERY provider: that's what makes them interchangeable. */
function contractTests(name: string, provider: CryptoProvider) {
  describe(`${name} (provider contract)`, () => {
    let keys: Awaited<ReturnType<CryptoProvider['generateKeyPair']>>;
    let otherKeys: typeof keys;
    let signature: Buffer;

    beforeAll(async () => {
      [keys, otherKeys] = await Promise.all([provider.generateKeyPair(), provider.generateKeyPair()]);
      signature = await provider.sign(message, keys.privateKey);
    });

    it('verifies its own signature', async () => {
      expect(await provider.verify(message, signature, keys.publicKey)).toBe(true);
    });

    it('rejects a tampered message', async () => {
      expect(await provider.verify(Buffer.from('Quantum-safe migration plan v2'), signature, keys.publicKey)).toBe(false);
    });

    it('rejects a signature checked against a different key', async () => {
      expect(await provider.verify(message, signature, otherKeys.publicKey)).toBe(false);
    });

    it('rejects a modified or malformed signature without throwing', async () => {
      const flipped = Buffer.from(signature);
      flipped[flipped.length - 1] ^= 0x01;
      expect(await provider.verify(message, flipped, keys.publicKey)).toBe(false);
      expect(await provider.verify(message, Buffer.from('garbage'), keys.publicKey)).toBe(false);
    });

    it('exports standard PEM keys (SPKI public, PKCS#8 private)', () => {
      expect(keys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(keys.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    });
  });
}

contractTests('RSA-PSS-3072', new RsaProvider());
contractTests('ECDSA-P256', new EcdsaProvider());
// The hybrid logic itself is tested with two classical parts, so it runs on every Node version.
contractTests('Hybrid ECDSA+RSA', new HybridProvider('HYBRID-ECDSA-P256+ML-DSA-65', new EcdsaProvider(), new RsaProvider()));

if (pqAvailable) {
  contractTests('ML-DSA-65', mlDsa);
  contractTests('Hybrid ECDSA+ML-DSA-65', new HybridProvider('HYBRID-ECDSA-P256+ML-DSA-65', new EcdsaProvider(), mlDsa));

  it('ML-DSA-65 has the sizes FIPS 204 specifies (signature 3309 bytes)', async () => {
    const keys = await mlDsa.generateKeyPair();
    expect((await mlDsa.sign(message, keys.privateKey)).length).toBe(3309);
  });
} else {
  describe('ML-DSA-65 on a runtime without support', () => {
    it('reports itself unavailable and explains why instead of crashing', async () => {
      expect(mlDsa.isAvailable()).toBe(false);
      await expect(mlDsa.generateKeyPair()).rejects.toThrow(AlgorithmUnavailableError);
      await expect(mlDsa.sign(message, 'x')).rejects.toThrow(/needs Node\.js 24\+/);
      expect(await mlDsa.verify(message, Buffer.from('x'), 'x')).toBe(false);
    });
  });
}

describe('HybridProvider', () => {
  const ecdsa = new EcdsaProvider();
  const rsa = new RsaProvider();
  const hybrid = new HybridProvider('HYBRID-ECDSA-P256+ML-DSA-65', ecdsa, rsa);

  it('fails if EITHER half of the signature is invalid (AND, not OR)', async () => {
    const keys = await hybrid.generateKeyPair();
    const signature = await hybrid.sign(message, keys.privateKey);
    const lengthA = signature.readUInt32BE(0);

    const brokenFirst = Buffer.from(signature);
    brokenFirst[4] ^= 0xff; // inside the ECDSA part
    const brokenSecond = Buffer.from(signature);
    brokenSecond[4 + lengthA + 10] ^= 0xff; // inside the second part

    expect(await hybrid.verify(message, brokenFirst, keys.publicKey)).toBe(false);
    expect(await hybrid.verify(message, brokenSecond, keys.publicKey)).toBe(false);
  });

  it('is quantum-safe when at least one component is', () => {
    expect(new HybridProvider('HYBRID-ECDSA-P256+ML-DSA-65', ecdsa, mlDsa).quantumSafe).toBe(true);
    expect(hybrid.quantumSafe).toBe(false); // ECDSA + RSA: both classical
  });

  it('is only available when both components are', () => {
    expect(new HybridProvider('HYBRID-ECDSA-P256+ML-DSA-65', ecdsa, mlDsa).isAvailable()).toBe(pqAvailable);
  });

  it('rejects keys that are not two PEM blocks', async () => {
    await expect(hybrid.sign(message, 'not a key')).rejects.toThrow('exactly two PEM blocks');
    expect(await hybrid.verify(message, Buffer.alloc(8), 'not a key')).toBe(false);
  });
});

describe('CryptoProviderRegistry', () => {
  const registry = new CryptoProviderRegistry();

  it('knows all four algorithms', () => {
    expect(registry.list().map((p) => p.algorithm)).toEqual([
      'RSA-PSS-3072-SHA256',
      'ECDSA-P256-SHA256',
      'ML-DSA-65',
      'HYBRID-ECDSA-P256+ML-DSA-65',
    ]);
  });

  it('resolves the configured algorithm', () => {
    expect(registry.resolveActive('ECDSA-P256-SHA256')).toBeInstanceOf(EcdsaProvider);
  });

  it('fails fast on a typo in the configuration', () => {
    expect(() => registry.resolveActive('ECDSA-P256')).toThrow(/must be one of/);
  });

  it('fails fast when the configured algorithm cannot run here', () => {
    if (pqAvailable) {
      expect(registry.resolveActive('ML-DSA-65').quantumSafe).toBe(true);
    } else {
      expect(() => registry.resolveActive('ML-DSA-65')).toThrow(AlgorithmUnavailableError);
    }
  });
});
