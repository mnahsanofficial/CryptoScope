// `as const` arrays give us both runtime values (for DB enums and validation) and TypeScript types.
// Order matters: worst first. Postgres sorts enum values in declaration order.
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The overall level of an asset is its worst finding, or 'none' if it has no findings. */
export const RISK_LEVELS = [...SEVERITIES, 'none'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const FINDING_CATEGORIES = ['certificate', 'protocol', 'quantum'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export type RuleId =
  | 'CERT_EXPIRED'
  | 'CERT_EXPIRING_SOON'
  | 'CERT_SELF_SIGNED'
  | 'CERT_UNTRUSTED_CHAIN'
  | 'WEAK_RSA_KEY'
  | 'WEAK_SIGNATURE_HASH'
  | 'LEGACY_TLS_VERSION'
  | 'QUANTUM_VULNERABLE_KEY'
  | 'NO_PQ_KEY_EXCHANGE';

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  category: FindingCategory;
  title: string;
  /** What we observed on this asset, with the specific values. */
  description: string;
  /** What to do about it. */
  recommendation: string;
  /** The raw values that triggered the rule, for audit and UI display. */
  evidence: Record<string, string | number | boolean | null>;
}

export interface RiskAssessment {
  /** 0 (no known risk) to 100 (worst). */
  score: number;
  level: RiskLevel;
  /** Sorted by severity, worst first. */
  findings: Finding[];
  assessedAt: string;
}

/** Public description of a rule (served by GET /api/risk/rules). */
export interface RuleMetadata {
  id: RuleId;
  severity: Severity;
  category: FindingCategory;
  title: string;
  rationale: string;
}
