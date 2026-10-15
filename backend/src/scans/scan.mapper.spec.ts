import { RiskEngine } from '../risk/risk-engine';
import { daysFromNow, makeScan, NOW, RSA_2048 } from '../risk/testing/make-scan';
import { ScanError } from '../scanner/scan-error';
import { toCertificateRow, toFailedScanRow, toFindingRows, toSuccessfulScanRow } from './scan.mapper';

describe('scan mapper', () => {
  const scan = makeScan({
    certificate: { ...RSA_2048, validTo: daysFromNow(-3) },
    trust: { authorized: false, error: 'CERT_HAS_EXPIRED' },
    tls: { protocol: 'TLSv1.2', postQuantumKeyExchange: null },
  });
  const risk = new RiskEngine().assess(scan, NOW);
  const base = { id: 'scan-1', assetId: 'asset-1', scannedAt: NOW, durationMs: 120 };

  it('flattens certificate info into a row with real Date objects', () => {
    const row = toCertificateRow(scan.certificate);

    expect(row).toMatchObject({
      keyAlgorithm: 'RSA',
      keySize: 2048,
      keyCurve: null,
      signatureAlgorithm: 'sha256WithRSAEncryption',
      signatureHash: 'SHA-256',
      selfSigned: false,
    });
    expect(row.validTo).toBeInstanceOf(Date);
    expect(row.validTo.toISOString()).toBe(scan.certificate.validTo);
  });

  it('maps a successful scan with its risk result', () => {
    const row = toSuccessfulScanRow({ ...base, certificateId: 'cert-1' }, scan, risk);

    expect(row).toMatchObject({
      status: 'success',
      protocol: 'TLSv1.2',
      trustAuthorized: false,
      trustError: 'CERT_HAS_EXPIRED',
      riskScore: 70,
      riskLevel: 'critical',
      certificateId: 'cert-1',
      errorCode: null,
    });
  });

  it('maps a failed scan without inventing a risk level', () => {
    const row = toFailedScanRow(base, new ScanError('TIMEOUT', 'No TLS handshake within 5000ms'));

    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'TIMEOUT',
      riskScore: null,
      riskLevel: null,
      certificateId: null,
      protocol: null,
    });
  });

  it('truncates very long error messages', () => {
    const row = toFailedScanRow(base, new ScanError('UNKNOWN', 'x'.repeat(5000)));
    expect(row.errorMessage).toHaveLength(1000);
  });

  it('creates one finding row per risk finding, linked to the scan and asset', () => {
    let n = 0;
    const rows = toFindingRows({ scanId: 'scan-1', assetId: 'asset-1' }, risk, NOW, () => `f-${++n}`);

    expect(rows.map((r) => r.ruleId)).toEqual(risk.findings.map((f) => f.ruleId));
    expect(rows[0]).toMatchObject({ id: 'f-1', scanId: 'scan-1', assetId: 'asset-1', severity: 'critical', createdAt: NOW });
  });
});
