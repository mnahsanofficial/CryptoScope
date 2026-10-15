import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { offsetOf, Paginated, toPaginated } from '../common/pagination';
import { percentage } from '../analytics/handshake-mappers';
import { RISK_LEVELS, RiskLevel, Severity, SEVERITIES } from '../risk/risk.types';
import { ExpiringCertificatesQueryDto } from './dashboard.dto';

export interface Overview {
  totalAssets: number;
  scannedAssets: number;
  averageRiskScore: number | null;
  assetsByRiskLevel: Record<RiskLevel, number>;
  /** Findings of each asset's LATEST scan only (history would count the same problem many times). */
  currentFindingsBySeverity: Record<Severity, number>;
  quantumVulnerableAssets: number;
  quantumVulnerablePercentage: number;
  certificatesExpiringIn30Days: number;
  expiredCertificates: number;
}

export interface ExpiringCertificate {
  assetId: string;
  host: string;
  port: number;
  environment: string;
  subject: string;
  issuer: string;
  keyAlgorithm: string;
  keySize: number | null;
  validTo: string;
  daysLeft: number;
}

/** "Current" data = each asset's newest successful scan, reached through assets.latest_scan_id. */
const CURRENT_FINDINGS = 'findings f JOIN assets a ON a.latest_scan_id = f.scan_id';
const CURRENT_CERTIFICATES = `assets a
  JOIN scans s ON s.id = a.latest_scan_id
  JOIN certificates c ON c.id = s.certificate_id`;

@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async overview(): Promise<Overview> {
    // Independent queries, run in parallel on separate pool connections.
    const [assets, levels, severities, quantum, certificates] = await Promise.all([
      this.db.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(latest_scan_id)::int AS scanned,
               ROUND(AVG(latest_risk_score))::int AS average_score
        FROM assets`),
      this.db.query(`SELECT latest_risk_level AS level, COUNT(*)::int AS count FROM assets
                     WHERE latest_risk_level IS NOT NULL GROUP BY 1`),
      this.db.query(`SELECT f.severity, COUNT(*)::int AS count FROM ${CURRENT_FINDINGS} GROUP BY 1`),
      this.db.query(`SELECT COUNT(DISTINCT f.asset_id)::int AS count FROM ${CURRENT_FINDINGS}
                     WHERE f.rule_id = 'QUANTUM_VULNERABLE_KEY'`),
      this.db.query(`
        SELECT COUNT(*) FILTER (WHERE c.valid_to > now() AND c.valid_to <= now() + interval '30 days')::int AS expiring,
               COUNT(*) FILTER (WHERE c.valid_to <= now())::int AS expired
        FROM ${CURRENT_CERTIFICATES}`),
    ]);

    const scanned: number = assets[0].scanned;
    return {
      totalAssets: assets[0].total,
      scannedAssets: scanned,
      averageRiskScore: assets[0].average_score,
      assetsByRiskLevel: countsByKey(RISK_LEVELS, levels, 'level'),
      currentFindingsBySeverity: countsByKey(SEVERITIES, severities, 'severity'),
      quantumVulnerableAssets: quantum[0].count,
      quantumVulnerablePercentage: percentage(quantum[0].count, scanned),
      certificatesExpiringIn30Days: certificates[0].expiring,
      expiredCertificates: certificates[0].expired,
    };
  }

  /** Certificates currently in use (latest scan per asset) that expire soon, most urgent first. */
  async expiringCertificates(query: ExpiringCertificatesQueryDto): Promise<Paginated<ExpiringCertificate>> {
    const where = query.includeExpired
      ? `c.valid_to <= now() + make_interval(days => $1)`
      : `c.valid_to > now() AND c.valid_to <= now() + make_interval(days => $1)`;

    const [rows, [{ total }]] = await Promise.all([
      this.db.query(
        `SELECT a.id AS "assetId", a.host, a.port, a.environment, c.subject, c.issuer,
                c.key_algorithm AS "keyAlgorithm", c.key_size AS "keySize", c.valid_to AS "validTo",
                FLOOR(EXTRACT(EPOCH FROM (c.valid_to - now())) / 86400)::int AS "daysLeft"
         FROM ${CURRENT_CERTIFICATES}
         WHERE ${where}
         ORDER BY c.valid_to ${query.order === 'desc' ? 'DESC' : 'ASC'}, a.id
         LIMIT $2 OFFSET $3`,
        [query.days, query.pageSize, offsetOf(query)],
      ),
      this.db.query(`SELECT COUNT(*)::int AS total FROM ${CURRENT_CERTIFICATES} WHERE ${where}`, [query.days]),
    ]);
    return toPaginated(rows as ExpiringCertificate[], total, query);
  }
}

function countsByKey<K extends string>(keys: readonly K[], rows: Array<Record<string, unknown>>, column: string): Record<K, number> {
  const result = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) result[row[column] as K] = Number(row.count);
  return result;
}
