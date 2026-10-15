import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { CryptoProviderRegistry } from './crypto-provider.registry';
import { SignatureAlgorithm } from './crypto-provider';
import { SigningService } from './signing.service';

const registry = new CryptoProviderRegistry();
const serviceWith = (active: SignatureAlgorithm) => new SigningService(registry, registry.get(active));
const available = registry.list().filter((p) => p.isAvailable()).map((p) => p.algorithm);

describe('SigningService', () => {
  it.each(available)('the SAME calling code works whichever algorithm is configured: %s', async (algorithm) => {
    const signing = serviceWith(algorithm); // only the configuration differs

    const signed = await signing.sign('release v2.0 manifest');
    const result = await signing.verify({ message: 'release v2.0 manifest', algorithm: signed.algorithm, signature: signed.signature, keyId: signed.keyId });

    expect(signed.algorithm).toBe(algorithm);
    expect(result).toMatchObject({ valid: true, algorithm });
  });

  it('migration: after switching the active algorithm, signatures made with the old one still verify', async () => {
    const signing = serviceWith('ECDSA-P256-SHA256');
    const old = await signing.sign('signed before the migration', 'RSA-PSS-3072-SHA256');

    const result = await signing.verify({ message: 'signed before the migration', algorithm: old.algorithm, signature: old.signature, keyId: old.keyId });

    expect(signing.activeAlgorithm).toBe('ECDSA-P256-SHA256');
    expect(result).toMatchObject({ valid: true, algorithm: 'RSA-PSS-3072-SHA256', quantumSafe: false });
  });

  it('rejects a tampered message', async () => {
    const signing = serviceWith('ECDSA-P256-SHA256');
    const signed = await signing.sign('pay 10 EUR');

    const result = await signing.verify({ message: 'pay 1000 EUR', algorithm: signed.algorithm, signature: signed.signature, keyId: signed.keyId });

    expect(result.valid).toBe(false);
  });

  it('can verify with a public key given by the caller (external verification)', async () => {
    const signing = serviceWith('ECDSA-P256-SHA256');
    const signed = await signing.sign('hello');

    const result = await serviceWith('RSA-PSS-3072-SHA256').verify({
      message: 'hello',
      algorithm: signed.algorithm,
      signature: signed.signature,
      publicKey: signed.publicKey,
    });

    expect(result.valid).toBe(true);
  });

  it('reuses one key per algorithm and reports its size', async () => {
    const signing = serviceWith('ECDSA-P256-SHA256');
    const [a, b] = await Promise.all([signing.sign('a'), signing.sign('b')]); // concurrent first use

    expect(a.keyId).toBe(b.keyId);
    expect(a.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(a.signatureBytes).toBeGreaterThan(60); // DER-encoded P-256 signature, ~70-72 bytes
  });

  it('needs a publicKey or a known keyId to verify', async () => {
    await expect(
      serviceWith('ECDSA-P256-SHA256').verify({ message: 'x', algorithm: 'ECDSA-P256-SHA256', signature: 'AAAA', keyId: '0123456789abcdef' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  if (!registry.get('ML-DSA-65').isAvailable()) {
    it('answers 501 Not Implemented when asked to sign with an algorithm this runtime lacks', async () => {
      await expect(serviceWith('ECDSA-P256-SHA256').sign('x', 'ML-DSA-65')).rejects.toBeInstanceOf(NotImplementedException);
    });
  }

  it('describes every provider, marks the active one and measures available ones', async () => {
    const providers = await serviceWith('ECDSA-P256-SHA256').describeProviders();

    const ecdsa = providers.find((p) => p.algorithm === 'ECDSA-P256-SHA256')!;
    expect(ecdsa).toMatchObject({ active: true, available: true, quantumSafe: false, family: 'ECC' });
    expect(ecdsa.measured?.publicKeyBytes).toBe(91); // SPKI of a P-256 key
    expect(providers.find((p) => p.algorithm === 'ML-DSA-65')).toMatchObject({ quantumSafe: true, family: 'Lattice', active: false });
  });
});
