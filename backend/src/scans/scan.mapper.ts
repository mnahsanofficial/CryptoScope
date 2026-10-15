import { Finding } from '../findings/finding.entity';
import { RiskAssessment } from '../risk/risk.types';
import { ScanError } from '../scanner/scan-error';
import { CertificateInfo, TlsScanResult } from '../scanner/scanner.types';
import { Certificate } from './certificate.entity';
import { Scan } from './scan.entity';

/**
 * Pure functions that turn scanner/risk output into database rows.
 * Kept separate from the service so they can be unit-tested without a database.
 */

export type CertificateRow = Omit<Certificate, 'id' | 'firstSeenAt' | 'scans'>;
export type ScanRow = Omit<Scan, 'asset' | 'certificate' | 'findings'>;
export type FindingRow = Omit<Finding, 'scan' | 'asset'>;

export function toCertificateRow(cert: CertificateInfo): CertificateRow {
  return {
    fingerprintSha256: cert.fingerprintSha256,
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber,
    subjectAltNames: cert.subjectAltNames,
    validFrom: new Date(cert.validFrom),
    validTo: new Date(cert.validTo),
    keyAlgorithm: cert.publicKey.algorithm,
    keySize: cert.publicKey.size,
    keyCurve: cert.publicKey.curve ?? null,
    signatureAlgorithm: cert.signatureAlgorithm.name,
    signatureHash: cert.signatureAlgorithm.hash,
    selfSigned: cert.selfSigned,
  };
}

interface ScanRowInput {
  id: string;
  assetId: string;
  scannedAt: Date;
  durationMs: number;
  certificateId: string | null;
}

export function toSuccessfulScanRow(input: ScanRowInput, result: TlsScanResult, risk: RiskAssessment): ScanRow {
  return {
    ...input,
    status: 'success',
    protocol: result.tls.protocol,
    cipher: result.tls.cipher.name,
    keyExchange: result.tls.keyExchange.name,
    postQuantumKeyExchange: result.tls.postQuantumKeyExchange,
    trustAuthorized: result.trust.authorized,
    trustError: result.trust.error,
    errorCode: null,
    errorMessage: null,
    riskScore: risk.score,
    riskLevel: risk.level,
  };
}

export function toFailedScanRow(input: Omit<ScanRowInput, 'certificateId'>, error: ScanError): ScanRow {
  return {
    ...input,
    certificateId: null,
    status: 'failed',
    protocol: null,
    cipher: null,
    keyExchange: null,
    postQuantumKeyExchange: null,
    trustAuthorized: null,
    trustError: null,
    errorCode: error.code,
    errorMessage: error.message.slice(0, 1000),
    // We couldn't observe anything, so we don't claim a risk level.
    riskScore: null,
    riskLevel: null,
  };
}

export function toFindingRows(
  ids: { scanId: string; assetId: string },
  risk: RiskAssessment,
  createdAt: Date,
  newId: () => string,
): FindingRow[] {
  return risk.findings.map((f) => ({
    id: newId(),
    scanId: ids.scanId,
    assetId: ids.assetId,
    ruleId: f.ruleId,
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    recommendation: f.recommendation,
    evidence: f.evidence,
    createdAt,
  }));
}
