import { RuleId } from './risk.types';
import { RULES } from './rules';
import { daysFromNow, makeScan, NOW, RSA_2048, ScanOverrides } from './testing/make-scan';

/** Runs a single rule against a scan built from the "ideal" baseline plus overrides. */
function run(ruleId: RuleId, overrides: ScanOverrides = {}) {
  const rule = RULES.find((r) => r.meta.id === ruleId);
  if (!rule) throw new Error(`No rule ${ruleId}`);
  return rule.evaluate(makeScan(overrides), { now: NOW });
}

describe('risk rules', () => {
  it('every rule is silent on the ideal baseline scan', () => {
    for (const rule of RULES) {
      expect({ id: rule.meta.id, finding: rule.evaluate(makeScan(), { now: NOW }) }).toEqual({
        id: rule.meta.id,
        finding: null,
      });
    }
  });

  it('every rule id is unique', () => {
    const ids = RULES.map((r) => r.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('CERT_EXPIRED (critical)', () => {
    it('fires for a certificate that expired in the past', () => {
      const finding = run('CERT_EXPIRED', { certificate: { validTo: daysFromNow(-10) } });

      expect(finding).toMatchObject({ severity: 'critical', category: 'certificate' });
      expect(finding?.evidence.daysSinceExpiry).toBe(10);
      expect(finding?.description).toContain('10 days ago');
    });

    it('fires at the exact moment of expiry', () => {
      expect(run('CERT_EXPIRED', { certificate: { validTo: NOW.toISOString() } })).not.toBeNull();
    });

    it('does not fire one second before expiry', () => {
      const validTo = new Date(NOW.getTime() + 1000).toISOString();
      expect(run('CERT_EXPIRED', { certificate: { validTo } })).toBeNull();
    });
  });

  describe('CERT_EXPIRING_SOON (high)', () => {
    it('fires when fewer than 30 days remain', () => {
      const finding = run('CERT_EXPIRING_SOON', { certificate: { validTo: daysFromNow(12) } });

      expect(finding).toMatchObject({ severity: 'high' });
      expect(finding?.evidence.daysUntilExpiry).toBe(12);
    });

    it('fires at 29 days but not at exactly 30 days', () => {
      expect(run('CERT_EXPIRING_SOON', { certificate: { validTo: daysFromNow(29) } })).not.toBeNull();
      expect(run('CERT_EXPIRING_SOON', { certificate: { validTo: daysFromNow(30) } })).toBeNull();
    });

    it('does not fire for an already expired certificate (CERT_EXPIRED covers that)', () => {
      expect(run('CERT_EXPIRING_SOON', { certificate: { validTo: daysFromNow(-1) } })).toBeNull();
    });
  });

  describe('CERT_SELF_SIGNED (medium)', () => {
    it('fires when the certificate is self-signed', () => {
      expect(run('CERT_SELF_SIGNED', { certificate: { selfSigned: true } })).toMatchObject({ severity: 'medium' });
    });

    it.each(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'])('fires on trust error %s', (error) => {
      expect(run('CERT_SELF_SIGNED', { trust: { authorized: false, error } })).not.toBeNull();
    });
  });

  describe('CERT_UNTRUSTED_CHAIN (medium)', () => {
    it('fires for trust errors without a more specific rule', () => {
      const finding = run('CERT_UNTRUSTED_CHAIN', {
        trust: { authorized: false, error: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' },
      });
      expect(finding).toMatchObject({ severity: 'medium', evidence: { trustError: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
    });

    it.each(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'])(
      'stays silent for %s, which has its own rule (no double counting)',
      (error) => {
        expect(run('CERT_UNTRUSTED_CHAIN', { trust: { authorized: false, error } })).toBeNull();
      },
    );
  });

  describe('WEAK_RSA_KEY (high)', () => {
    it.each([512, 1024, 2047])('fires for a %i-bit RSA key', (size) => {
      const finding = run('WEAK_RSA_KEY', { certificate: { publicKey: { ...RSA_2048.publicKey, size } } });
      expect(finding).toMatchObject({ severity: 'high', evidence: { keySize: size } });
    });

    it.each([2048, 3072, 4096])('does not fire for a %i-bit RSA key', (size) => {
      expect(run('WEAK_RSA_KEY', { certificate: { publicKey: { ...RSA_2048.publicKey, size } } })).toBeNull();
    });

    it('ignores non-RSA keys (a 256-bit EC key is strong)', () => {
      const publicKey = { algorithm: 'EC' as const, size: 256, curve: 'prime256v1', oid: '1.2.840.10045.2.1' };
      expect(run('WEAK_RSA_KEY', { certificate: { publicKey } })).toBeNull();
    });
  });

  describe('WEAK_SIGNATURE_HASH (high, critical for MD5)', () => {
    it('fires as high for SHA-1', () => {
      const signatureAlgorithm = { name: 'sha1WithRSAEncryption', hash: 'SHA-1', oid: '1.2.840.113549.1.1.5' };
      expect(run('WEAK_SIGNATURE_HASH', { certificate: { signatureAlgorithm } })).toMatchObject({ severity: 'high' });
    });

    it('escalates to critical for MD5', () => {
      const signatureAlgorithm = { name: 'md5WithRSAEncryption', hash: 'MD5', oid: '1.2.840.113549.1.1.4' };
      expect(run('WEAK_SIGNATURE_HASH', { certificate: { signatureAlgorithm } })).toMatchObject({
        severity: 'critical',
      });
    });

    it('does not fire for SHA-256', () => {
      expect(run('WEAK_SIGNATURE_HASH', { certificate: { ...RSA_2048 } })).toBeNull();
    });
  });

  describe('LEGACY_TLS_VERSION (high, critical for SSLv3)', () => {
    it.each(['TLSv1', 'TLSv1.1'])('fires as high for %s', (protocol) => {
      expect(run('LEGACY_TLS_VERSION', { tls: { protocol } })).toMatchObject({
        severity: 'high',
        category: 'protocol',
        evidence: { protocol },
      });
    });

    it('escalates to critical for SSLv3', () => {
      expect(run('LEGACY_TLS_VERSION', { tls: { protocol: 'SSLv3' } })).toMatchObject({ severity: 'critical' });
    });

    it.each(['TLSv1.2', 'TLSv1.3'])('does not fire for %s', (protocol) => {
      expect(run('LEGACY_TLS_VERSION', { tls: { protocol } })).toBeNull();
    });
  });

  describe('QUANTUM_VULNERABLE_KEY (medium)', () => {
    it.each([
      [{ algorithm: 'RSA' as const, size: 4096, oid: 'x' }, 'factorisation'],
      [{ algorithm: 'EC' as const, size: 384, curve: 'secp384r1', oid: 'x' }, 'discrete logarithm'],
      [{ algorithm: 'Ed25519' as const, size: 256, oid: 'x' }, 'discrete logarithm'],
    ])('fires for %o (even strong classical keys are broken by Shor)', (publicKey, problem) => {
      const finding = run('QUANTUM_VULNERABLE_KEY', { certificate: { publicKey } });

      expect(finding).toMatchObject({ severity: 'medium', category: 'quantum' });
      expect(finding?.description).toContain(problem);
    });

    it.each(['ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87'] as const)('does not fire for post-quantum %s', (algorithm) => {
      expect(run('QUANTUM_VULNERABLE_KEY', { certificate: { publicKey: { algorithm, size: null, oid: 'x' } } })).toBeNull();
    });
  });

  describe('NO_PQ_KEY_EXCHANGE (medium)', () => {
    it('fires when a TLS 1.3 server rejects hybrid ML-KEM', () => {
      expect(run('NO_PQ_KEY_EXCHANGE', { tls: { postQuantumKeyExchange: false } })).toMatchObject({
        severity: 'medium',
        category: 'quantum',
      });
    });

    it('fires for TLS 1.2 servers, which cannot negotiate hybrid groups at all', () => {
      const finding = run('NO_PQ_KEY_EXCHANGE', { tls: { protocol: 'TLSv1.2', postQuantumKeyExchange: null } });
      expect(finding?.description).toContain('requires TLS 1.3');
    });

    it('stays silent when the probe was inconclusive on TLS 1.3 (we do not report what we do not know)', () => {
      expect(run('NO_PQ_KEY_EXCHANGE', { tls: { postQuantumKeyExchange: null } })).toBeNull();
    });
  });
});
