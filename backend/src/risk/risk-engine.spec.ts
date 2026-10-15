import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCertificate } from '../scanner/certificate-parser';
import { calculateScore, RiskEngine, worstSeverity } from './risk-engine';
import { Finding, Severity } from './risk.types';
import { RiskRule } from './rules';
import { daysFromNow, makeScan, NOW, RSA_2048 } from './testing/make-scan';

const fakeFinding = (severity: Severity): Finding => ({
  ruleId: 'CERT_EXPIRED',
  severity,
  category: 'certificate',
  title: 't',
  description: 'd',
  recommendation: 'r',
  evidence: {},
});

describe('RiskEngine', () => {
  const engine = new RiskEngine();

  it('gives the ideal post-quantum server a score of 0 and level none', () => {
    expect(engine.assess(makeScan(), NOW)).toEqual({
      score: 0,
      level: 'none',
      findings: [],
      assessedAt: NOW.toISOString(),
    });
  });

  it('a modern but classical server (like github.com) is medium risk: quantum exposure only', () => {
    const scan = makeScan({ certificate: { ...RSA_2048 }, tls: { postQuantumKeyExchange: false } });

    const result = engine.assess(scan, NOW);

    expect(result.findings.map((f) => f.ruleId)).toEqual(['QUANTUM_VULNERABLE_KEY', 'NO_PQ_KEY_EXCHANGE']);
    expect(result).toMatchObject({ score: 20, level: 'medium' });
  });

  it('scores an expired TLS 1.2 RSA server (like expired.badssl.com) as critical', () => {
    const scan = makeScan({
      certificate: { ...RSA_2048, validTo: daysFromNow(-400) },
      trust: { authorized: false, error: 'CERT_HAS_EXPIRED' },
      tls: { protocol: 'TLSv1.2', postQuantumKeyExchange: null },
    });

    const result = engine.assess(scan, NOW);

    // 50 (critical) + 10 + 10 (two quantum mediums)
    expect(result).toMatchObject({ score: 70, level: 'critical' });
    expect(result.findings[0].ruleId).toBe('CERT_EXPIRED'); // worst first
  });

  it('caps the score at 100 when many things are wrong', () => {
    const scan = makeScan({
      certificate: {
        publicKey: { algorithm: 'RSA', size: 1024, oid: 'x' },
        signatureAlgorithm: { name: 'md5WithRSAEncryption', hash: 'MD5', oid: 'x' },
        validTo: daysFromNow(-1),
        selfSigned: true,
      },
      tls: { protocol: 'TLSv1', postQuantumKeyExchange: null },
    });

    const result = engine.assess(scan, NOW);

    expect(result.score).toBe(100);
    expect(result.level).toBe('critical');
    expect(result.findings.length).toBeGreaterThanOrEqual(6);
  });

  it('sorts findings from worst to least severe', () => {
    const scan = makeScan({
      certificate: { ...RSA_2048, selfSigned: true, validTo: daysFromNow(5) },
      tls: { protocol: 'TLSv1.1', postQuantumKeyExchange: null },
    });

    const severities = engine.assess(scan, NOW).findings.map((f) => f.severity);

    expect(severities).toEqual([...severities].sort((a, b) => order(a) - order(b)));
    expect(severities[0]).toBe('high');
  });

  it('is deterministic: the injected clock decides expiry, not the real time', () => {
    const scan = makeScan({ certificate: { validTo: '2026-06-15T00:00:00.000Z' } });

    expect(engine.assess(scan, new Date('2026-05-01T00:00:00Z')).findings).toEqual([]);
    expect(engine.assess(scan, new Date('2026-06-10T00:00:00Z')).findings[0].ruleId).toBe('CERT_EXPIRING_SOON');
    expect(engine.assess(scan, new Date('2026-07-01T00:00:00Z')).findings[0].ruleId).toBe('CERT_EXPIRED');
  });

  it('runs only the rules it is given (rules are pluggable)', () => {
    const alwaysLow: RiskRule = {
      meta: { id: 'CERT_SELF_SIGNED', severity: 'low', category: 'certificate', title: 'x', rationale: 'x' },
      evaluate: () => fakeFinding('low'),
    };

    const result = new RiskEngine([alwaysLow]).assess(makeScan(), NOW);

    expect(result).toMatchObject({ score: 3, level: 'low' });
  });

  it('works on a real parsed certificate: RSA-1024 / SHA-1 / self-signed fixture', () => {
    const pem = readFileSync(join(__dirname, '../scanner/__fixtures__/rsa1024-sha1.crt'));
    const certificate = parseCertificate(new X509Certificate(pem).raw);
    const scan = makeScan({ certificate, trust: { authorized: false, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });

    const result = engine.assess(scan, NOW);

    expect(result.findings.map((f) => f.ruleId).sort()).toEqual(
      ['CERT_SELF_SIGNED', 'QUANTUM_VULNERABLE_KEY', 'WEAK_RSA_KEY', 'WEAK_SIGNATURE_HASH'].sort(),
    );
    expect(result).toMatchObject({ score: 70, level: 'high' }); // 25 + 25 + 10 + 10
  });

  it('lists metadata for every rule', () => {
    const rules = engine.listRules();
    expect(rules).toHaveLength(9);
    expect(rules.every((r) => r.rationale.length > 0)).toBe(true);
  });
});

describe('calculateScore / worstSeverity', () => {
  it('sums severity weights', () => {
    expect(calculateScore([fakeFinding('high'), fakeFinding('medium'), fakeFinding('low')])).toBe(38);
  });

  it('returns 0 and none with no findings', () => {
    expect(calculateScore([])).toBe(0);
    expect(worstSeverity([])).toBe('none');
  });

  it('level follows the worst finding even when the score is low', () => {
    // 4 lows = 12 points, but one critical (50) is always "critical", never "medium".
    expect(worstSeverity([fakeFinding('low'), fakeFinding('critical')])).toBe('critical');
  });
});

function order(severity: Severity): number {
  return ['critical', 'high', 'medium', 'low'].indexOf(severity);
}
