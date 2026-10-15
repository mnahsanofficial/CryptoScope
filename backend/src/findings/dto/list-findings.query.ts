import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { CommaSeparated, PaginationQueryDto } from '../../common/pagination';
import { RULES } from '../../risk/rules';
import { FINDING_CATEGORIES, FindingCategory, RuleId, SEVERITIES, Severity } from '../../risk/risk.types';

export const FINDING_SORT_FIELDS = ['createdAt', 'severity'] as const;
const RULE_IDS = RULES.map((r) => r.meta.id);

/**
 * GET /api/findings?severity=critical,high&category=quantum&assetId=...&from=2026-01-01&sort=createdAt&order=desc
 */
export class ListFindingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @CommaSeparated()
  @IsIn(SEVERITIES, { each: true })
  severity?: Severity[];

  @IsOptional()
  @CommaSeparated()
  @IsIn(FINDING_CATEGORIES, { each: true })
  category?: FindingCategory[];

  @IsOptional()
  @CommaSeparated()
  @IsIn(RULE_IDS, { each: true })
  ruleId?: RuleId[];

  @IsOptional()
  @IsUUID()
  assetId?: string;

  /** Only findings created at or after this time (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Only findings created before this time (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsIn(FINDING_SORT_FIELDS)
  sort: (typeof FINDING_SORT_FIELDS)[number] = 'createdAt';
}
