import type { estypes } from '@elastic/elasticsearch';
import { Finding } from './finding.entity';

/**
 * Elasticsearch copy of the findings, used for full-text search on the Findings page.
 * PostgreSQL stays the source of truth; this index can always be rebuilt (npm run findings:reindex).
 *
 * The API reads and writes the ALIAS (e.g. "cryptoscope-findings"), which points at a versioned index
 * ("cryptoscope-findings-20261017..."), so a rebuild can switch indices without downtime.
 */
export const FINDINGS_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  analysis: {
    tokenizer: {
      // "qa.zeuz.ai" -> ["qa", "zeuz", "ai"], "api.globex-1072.com" -> ["api", "globex", "1072", "com"]
      domain_parts: { type: 'pattern', pattern: '[^A-Za-z0-9]+' },
    },
    analyzer: {
      domain_parts: { type: 'custom', tokenizer: 'domain_parts', filter: ['lowercase'] },
    },
  },
};

export const FINDINGS_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    finding_id: { type: 'keyword' },
    scan_id: { type: 'keyword' },
    asset_id: { type: 'keyword' },
    // keyword for exact filters; .parts so "zeuz" or "qa" finds qa.zeuz.ai
    host: { type: 'keyword', fields: { parts: { type: 'text', analyzer: 'domain_parts' } } },
    port: { type: 'integer' },
    environment: { type: 'keyword' },
    rule_id: { type: 'keyword' },
    severity: { type: 'keyword' },
    category: { type: 'keyword' },
    // english analyzer = stemming: "expired", "expires" and "expiring" all match each other
    title: { type: 'text', analyzer: 'english', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
    description: { type: 'text', analyzer: 'english' },
    recommendation: { type: 'text', analyzer: 'english' },
    // Evidence keys differ per rule. "flattened" indexes the whole object as ONE field (no mapping explosion).
    evidence: { type: 'flattened' },
    risk_score: { type: 'short' },
    risk_level: { type: 'keyword' },
    // True for findings of the asset's latest successful scan, i.e. the dashboard's "current only" view.
    is_current: { type: 'boolean' },
    created_at: { type: 'date' },
  },
};

export interface FindingDocument {
  finding_id: string;
  scan_id: string;
  asset_id: string;
  host: string;
  port: number;
  environment: string;
  rule_id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  evidence: Finding['evidence'];
  risk_score: number | null;
  risk_level: string | null;
  is_current: boolean;
  created_at: Date | string;
}

/** A finding loaded together with its asset and scan (TypeORM relations). */
export function toFindingDocument(f: Finding, isCurrent: boolean): FindingDocument {
  return {
    finding_id: f.id,
    scan_id: f.scanId,
    asset_id: f.assetId,
    host: f.asset.host,
    port: f.asset.port,
    environment: f.asset.environment,
    rule_id: f.ruleId,
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    recommendation: f.recommendation,
    evidence: f.evidence,
    risk_score: f.scan.riskScore,
    risk_level: f.scan.riskLevel,
    is_current: isCurrent,
    created_at: f.createdAt,
  };
}

/** Versioned index name for a rebuild, e.g. cryptoscope-findings-20261017171234. */
export function versionedIndexName(alias: string, now: Date = new Date()): string {
  return `${alias}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}
