import { TlsScanResult } from '../scanner/scanner.types';
import { RiskRule, RULES } from './rules';
import { Finding, RiskAssessment, RiskLevel, RuleMetadata, Severity, SEVERITIES } from './risk.types';

/**
 * Points each finding adds to the score. The score is the sum, capped at 100.
 * One critical finding alone puts an asset at 50; several highs add up quickly.
 */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 50,
  high: 25,
  medium: 10,
  low: 3,
};

const SEVERITY_ORDER: readonly Severity[] = SEVERITIES;

/**
 * Turns a scan result into a risk assessment by running every rule.
 * Pure: the same scan and `now` always give the same result, which makes it easy to test
 * and lets us re-assess old scans when the rules change.
 * Plain class (no Nest decorators), so it also works in the CLI and in tests with custom rules.
 */
export class RiskEngine {
  constructor(private readonly rules: readonly RiskRule[] = RULES) {}

  assess(scan: TlsScanResult, now: Date = new Date()): RiskAssessment {
    const findings = this.rules
      .map((rule) => rule.evaluate(scan, { now }))
      .filter((f): f is Finding => f !== null)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

    return {
      score: calculateScore(findings),
      level: worstSeverity(findings),
      findings,
      assessedAt: now.toISOString(),
    };
  }

  listRules(): RuleMetadata[] {
    return this.rules.map((rule) => rule.meta);
  }
}

export function calculateScore(findings: readonly Finding[]): number {
  const total = findings.reduce((sum, f) => sum + SEVERITY_WEIGHTS[f.severity], 0);
  return Math.min(100, total);
}

/** The level is driven by the worst finding, not the score: one critical issue is never "medium". */
export function worstSeverity(findings: readonly Finding[]): RiskLevel {
  return SEVERITY_ORDER.find((severity) => findings.some((f) => f.severity === severity)) ?? 'none';
}
