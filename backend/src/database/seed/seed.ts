/**
 * Fills the database with realistic fake data: 20,000 assets x 5 scans = 100,000 scans,
 * plus their certificates and ~300,000 findings produced by the REAL risk engine.
 *
 *   npm run seed                    # default 20,000 assets
 *   npm run seed -- --assets 2000   # smaller run
 *
 * WARNING: empties the assets, scans, certificates and findings tables first.
 */
// Decorators (entities, DTOs) need this; Nest loads it automatically, standalone scripts must do it themselves.
import 'reflect-metadata';
import { ObjectLiteral } from 'typeorm';
import { Asset, Environment } from '../../assets/asset.entity';
import { Finding } from '../../findings/finding.entity';
import { RiskEngine } from '../../risk/risk-engine';
import { ScanError } from '../../scanner/scan-error';
import { CertificateInfo, KeyAlgorithm, ScanErrorCode, TlsScanResult } from '../../scanner/scanner.types';
import { Certificate } from '../../scans/certificate.entity';
import { Scan } from '../../scans/scan.entity';
import {
  CertificateRow,
  FindingRow,
  ScanRow,
  toCertificateRow,
  toFailedScanRow,
  toFindingRows,
  toSuccessfulScanRow,
} from '../../scans/scan.mapper';
import dataSource from '../data-source';
import { SeededRandom } from './random';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCANS_PER_ASSET = 5;
const SCAN_INTERVAL_DAYS = 30;
const ASSETS_PER_BATCH = 1_000;
// Postgres allows at most 65,535 bind parameters per query; 2,000 rows x ~16 columns stays well below.
const ROWS_PER_INSERT = 2_000;

const random = new SeededRandom(20261016);
const riskEngine = new RiskEngine();

// ---------- fake-world vocabulary ----------
const SUBDOMAINS = ['www', 'api', 'auth', 'vpn', 'mail', 'portal', 'payments', 'cdn', 'admin', 'sso', 'gateway', 'app'];
const ORGS = ['northwind', 'contoso', 'fabrikam', 'initech', 'umbrella', 'globex', 'acme', 'wayne', 'stark', 'hooli'];
const TLDS = ['com', 'net', 'io', 'org', 'ca', 'co.uk'];
const PUBLIC_CAS = [
  "CN=R11, O=Let's Encrypt, C=US",
  'CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1, O=DigiCert Inc, C=US',
  'CN=Sectigo RSA Domain Validation Secure Server CA, O=Sectigo Limited, C=GB',
  'CN=GTS CA 1C3, O=Google Trust Services LLC, C=US',
];

interface KeyProfile {
  algorithm: KeyAlgorithm;
  size: number | null;
  curve?: string;
  oid: string;
  signatures: ReadonlyArray<readonly [{ name: string; hash: string | null; oid: string }, number]>;
}

const RSA_SIGS = [
  [{ name: 'sha256WithRSAEncryption', hash: 'SHA-256', oid: '1.2.840.113549.1.1.11' }, 90],
  [{ name: 'sha384WithRSAEncryption', hash: 'SHA-384', oid: '1.2.840.113549.1.1.12' }, 5],
  [{ name: 'sha1WithRSAEncryption', hash: 'SHA-1', oid: '1.2.840.113549.1.1.5' }, 4],
  [{ name: 'md5WithRSAEncryption', hash: 'MD5', oid: '1.2.840.113549.1.1.4' }, 1],
] as const;
const EC_SIGS = [
  [{ name: 'ecdsa-with-SHA256', hash: 'SHA-256', oid: '1.2.840.10045.4.3.2' }, 85],
  [{ name: 'ecdsa-with-SHA384', hash: 'SHA-384', oid: '1.2.840.10045.4.3.3' }, 14],
  [{ name: 'ecdsa-with-SHA1', hash: 'SHA-1', oid: '1.2.840.10045.4.1' }, 1],
] as const;

const KEY_PROFILES: ReadonlyArray<readonly [KeyProfile, number]> = [
  [{ algorithm: 'EC', size: 256, curve: 'prime256v1', oid: '1.2.840.10045.2.1', signatures: EC_SIGS }, 42],
  [{ algorithm: 'RSA', size: 2048, oid: '1.2.840.113549.1.1.1', signatures: RSA_SIGS }, 36],
  [{ algorithm: 'RSA', size: 4096, oid: '1.2.840.113549.1.1.1', signatures: RSA_SIGS }, 10],
  [{ algorithm: 'EC', size: 384, curve: 'secp384r1', oid: '1.2.840.10045.2.1', signatures: EC_SIGS }, 5],
  [{ algorithm: 'RSA', size: 1024, oid: '1.2.840.113549.1.1.1', signatures: RSA_SIGS }, 3],
  [{ algorithm: 'Ed25519', size: 256, oid: '1.3.101.112', signatures: [[{ name: 'Ed25519', hash: null, oid: '1.3.101.112' }, 1]] }, 1],
  [{ algorithm: 'ML-DSA-65', size: null, oid: '2.16.840.1.101.3.4.3.18', signatures: [[{ name: 'ML-DSA-65', hash: null, oid: '2.16.840.1.101.3.4.3.18' }, 1]] }, 3],
];

const CIPHERS: Record<string, string> = {
  'TLSv1.3': 'TLS_AES_128_GCM_SHA256',
  'TLSv1.2': 'ECDHE-RSA-AES128-GCM-SHA256',
  'TLSv1.1': 'ECDHE-RSA-AES256-SHA',
  TLSv1: 'ECDHE-RSA-AES256-SHA',
};

/** How one fake server is configured. Servers rarely change, so it's fixed for all of its scans. */
interface ServerProfile {
  key: KeyProfile;
  protocol: string;
  pqKeyExchange: boolean | null;
  selfSigned: boolean;
  trustError: string | null;
  autoRenew: boolean;
  lifetimeDays: number;
}

function randomServerProfile(): ServerProfile {
  const protocol = random.weighted([['TLSv1.3', 55], ['TLSv1.2', 38], ['TLSv1.1', 3], ['TLSv1', 4]] as const);
  const selfSigned = random.chance(0.04);
  return {
    key: random.weighted(KEY_PROFILES),
    protocol,
    pqKeyExchange:
      protocol === 'TLSv1.3' ? random.weighted([[true, 40], [false, 55], [null, 5]] as const) : null,
    selfSigned,
    trustError: selfSigned ? 'DEPTH_ZERO_SELF_SIGNED_CERT' : random.chance(0.02) ? 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' : null,
    autoRenew: random.chance(0.92),
    lifetimeDays: random.weighted([[90, 50], [365, 25], [398, 25]] as const),
  };
}

function fakeCertificate(host: string, profile: ServerProfile, validFrom: Date): CertificateInfo {
  const subject = `CN=${host}`;
  return {
    subject,
    issuer: profile.selfSigned ? subject : random.pick(PUBLIC_CAS),
    subjectAltNames: [host],
    serialNumber: random.hex(16),
    validFrom: validFrom.toISOString(),
    validTo: new Date(validFrom.getTime() + profile.lifetimeDays * DAY_MS).toISOString(),
    publicKey: { algorithm: profile.key.algorithm, size: profile.key.size, curve: profile.key.curve, oid: profile.key.oid },
    signatureAlgorithm: random.weighted(profile.key.signatures),
    selfSigned: profile.selfSigned,
    fingerprintSha256: random.hex(32).match(/../g)!.join(':'),
  };
}

function fakeScanResult(host: string, port: number, profile: ServerProfile, cert: CertificateInfo, at: Date): TlsScanResult {
  const expired = new Date(cert.validTo) <= at;
  return {
    target: { host, port },
    scannedAt: at.toISOString(),
    durationMs: random.int(40, 900),
    remoteAddress: `198.51.100.${random.int(1, 254)}`,
    tls: {
      protocol: profile.protocol,
      cipher: { name: CIPHERS[profile.protocol], standardName: CIPHERS[profile.protocol] },
      keyExchange: profile.pqKeyExchange ? { type: null, name: null, size: null } : { type: 'ECDH', name: 'X25519', size: 253 },
      postQuantumKeyExchange: profile.pqKeyExchange,
    },
    trust: {
      authorized: !expired && !profile.trustError,
      error: expired ? 'CERT_HAS_EXPIRED' : profile.trustError,
    },
    certificate: cert,
  };
}

interface Batch {
  assets: ObjectLiteral[];
  certificates: Array<CertificateRow & { id: string }>;
  scans: ScanRow[];
  findings: FindingRow[];
}

function generateAsset(index: number, now: Date, batch: Batch): void {
  const host = `${random.pick(SUBDOMAINS)}.${random.pick(ORGS)}-${index}.${random.pick(TLDS)}`;
  const port = random.chance(0.05) ? 8443 : 443;
  const assetId = random.uuid();
  const profile = randomServerProfile();
  const firstScanAt = new Date(now.getTime() - SCANS_PER_ASSET * SCAN_INTERVAL_DAYS * DAY_MS);

  let cert = fakeCertificate(host, profile, new Date(firstScanAt.getTime() - random.int(10, 300) * DAY_MS));
  let certId = random.uuid();
  batch.certificates.push({ id: certId, ...toCertificateRow(cert) });

  let latest: { score: number; level: Asset['latestRiskLevel']; at: Date } | null = null;
  let lastScannedAt = firstScanAt;

  for (let i = 0; i < SCANS_PER_ASSET; i++) {
    const scannedAt = new Date(firstScanAt.getTime() + (i * SCAN_INTERVAL_DAYS + random.int(0, 5)) * DAY_MS);
    lastScannedAt = scannedAt;
    const scanId = random.uuid();
    const durationMs = random.int(40, 900);

    // Well-run servers renew before expiry; the rest keep serving an expired certificate.
    if (profile.autoRenew && new Date(cert.validTo).getTime() - scannedAt.getTime() < 15 * DAY_MS) {
      cert = fakeCertificate(host, profile, new Date(scannedAt.getTime() - random.int(1, 10) * DAY_MS));
      certId = random.uuid();
      batch.certificates.push({ id: certId, ...toCertificateRow(cert) });
    }

    if (random.chance(0.03)) {
      const code = random.pick<ScanErrorCode>(['TIMEOUT', 'CONNECTION_REFUSED', 'DNS_NOT_FOUND']);
      batch.scans.push(toFailedScanRow({ id: scanId, assetId, scannedAt, durationMs }, new ScanError(code, `Simulated ${code}`)));
      continue;
    }

    const result = fakeScanResult(host, port, profile, cert, scannedAt);
    const risk = riskEngine.assess(result, scannedAt);
    batch.scans.push(toSuccessfulScanRow({ id: scanId, assetId, scannedAt, durationMs, certificateId: certId }, result, risk));
    batch.findings.push(...toFindingRows({ scanId, assetId }, risk, scannedAt, () => random.uuid()));
    latest = { score: risk.score, level: risk.level, at: scannedAt };
  }

  batch.assets.push({
    id: assetId,
    host,
    port,
    label: null,
    environment: random.weighted<Environment>([['production', 70], ['staging', 20], ['development', 10]]),
    latestRiskScore: latest?.score ?? null,
    latestRiskLevel: latest?.level ?? null,
    lastScannedAt,
    createdAt: new Date(firstScanAt.getTime() - DAY_MS),
  });
}

async function insertInChunks(target: Function, rows: ObjectLiteral[]): Promise<void> {
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    await dataSource.createQueryBuilder().insert().into(target).values(rows.slice(i, i + ROWS_PER_INSERT)).execute();
  }
}

function parseAssetCount(): number {
  const flag = process.argv.indexOf('--assets');
  const value = flag >= 0 ? Number(process.argv[flag + 1]) : 20_000;
  if (!Number.isInteger(value) || value < 1) throw new Error('--assets must be a positive integer');
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');

  const assetCount = parseAssetCount();
  await dataSource.initialize();
  const { database, host, port } = dataSource.options as { database: string; host: string; port: number };
  console.log(`Seeding ${assetCount} assets into ${database} at ${host}:${port} ...`);

  const started = Date.now();
  const now = new Date();
  const totals = { assets: 0, certificates: 0, scans: 0, findings: 0 };

  await dataSource.query('TRUNCATE findings, scans, certificates, assets');

  for (let start = 0; start < assetCount; start += ASSETS_PER_BATCH) {
    const batch: Batch = { assets: [], certificates: [], scans: [], findings: [] };
    for (let i = start; i < Math.min(start + ASSETS_PER_BATCH, assetCount); i++) generateAsset(i, now, batch);

    // Parents before children, so foreign keys are satisfied.
    await dataSource.transaction(async () => {
      await insertInChunks(Asset, batch.assets);
      await insertInChunks(Certificate, batch.certificates);
      await insertInChunks(Scan, batch.scans);
      await insertInChunks(Finding, batch.findings);
    });

    totals.assets += batch.assets.length;
    totals.certificates += batch.certificates.length;
    totals.scans += batch.scans.length;
    totals.findings += batch.findings.length;
    process.stdout.write(`\r  ${totals.assets}/${assetCount} assets`);
  }

  // Refresh planner statistics (and the visibility map, which enables index-only scans).
  console.log('\n  VACUUM ANALYZE ...');
  await dataSource.query('VACUUM ANALYZE assets, certificates, scans, findings');

  const total = totals.assets + totals.certificates + totals.scans + totals.findings;
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s:`, { ...totals, total });
  await dataSource.destroy();
}

main().catch(async (err: unknown) => {
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
