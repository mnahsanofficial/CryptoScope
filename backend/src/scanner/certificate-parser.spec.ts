import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCertificate } from './certificate-parser';
import { readAlgorithmOids } from './x509-der';

// Fixtures were generated with OpenSSL 3.5 (`openssl req -x509 ...`); see __fixtures__/README.md.
function fixtureDer(name: string): Buffer {
  const pem = readFileSync(join(__dirname, '__fixtures__', name));
  return new X509Certificate(pem).raw;
}

describe('parseCertificate', () => {
  it.each([
    ['rsa2048-sha256.crt', { algorithm: 'RSA', size: 2048 }, 'sha256WithRSAEncryption', 'SHA-256'],
    ['rsa1024-sha1.crt', { algorithm: 'RSA', size: 1024 }, 'sha1WithRSAEncryption', 'SHA-1'],
    ['ec-p256-sha256.crt', { algorithm: 'EC', size: 256, curve: 'prime256v1' }, 'ecdsa-with-SHA256', 'SHA-256'],
    ['ed25519.crt', { algorithm: 'Ed25519', size: 256 }, 'Ed25519', null],
    // Post-quantum: Node 22 can't load this key, so the algorithm comes from our DER reader.
    ['ml-dsa-65.crt', { algorithm: 'ML-DSA-65', size: null }, 'ML-DSA-65', null],
  ])('%s -> key %o, signature %s', (file, expectedKey, signatureName, hash) => {
    const info = parseCertificate(fixtureDer(file));

    expect(info.publicKey).toMatchObject(expectedKey);
    expect(info.signatureAlgorithm).toMatchObject({ name: signatureName, hash });
    expect(info.selfSigned).toBe(true);
  });

  it('extracts names, dates and fingerprint', () => {
    const info = parseCertificate(fixtureDer('rsa2048-sha256.crt'));

    expect(info.subject).toBe('CN=localhost, O=CryptoScope Test');
    expect(info.issuer).toBe(info.subject);
    expect(info.subjectAltNames).toEqual(['localhost', '127.0.0.1']);
    expect(new Date(info.validTo).getTime()).toBeGreaterThan(new Date(info.validFrom).getTime());
    expect(info.fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe('readAlgorithmOids', () => {
  it('reads both OIDs from raw DER', () => {
    expect(readAlgorithmOids(fixtureDer('ec-p256-sha256.crt'))).toEqual({
      signatureAlgorithmOid: '1.2.840.10045.4.3.2',
      publicKeyAlgorithmOid: '1.2.840.10045.2.1',
    });
  });

  it('throws on malformed input instead of reading out of bounds', () => {
    expect(() => readAlgorithmOids(Buffer.from([0x30, 0x82, 0xff, 0xff]))).toThrow('Malformed DER');
    expect(() => readAlgorithmOids(Buffer.from([0x02, 0x01, 0x00]))).toThrow('Malformed DER');
    expect(() => readAlgorithmOids(Buffer.alloc(0))).toThrow('Malformed DER');
  });

  it('rejects a certificate truncated in the middle', () => {
    const der = fixtureDer('rsa2048-sha256.crt');
    expect(() => readAlgorithmOids(der.subarray(0, der.length / 2))).toThrow('Malformed DER');
  });
});
