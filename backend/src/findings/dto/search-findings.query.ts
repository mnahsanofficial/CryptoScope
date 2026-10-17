import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CommaSeparated, MAX_PAGE_SIZE } from '../../common/pagination';
import { BooleanFromQuery } from '../../dashboard/dashboard.dto';
import { RULES } from '../../risk/rules';
import { FINDING_CATEGORIES, FindingCategory, SEVERITIES, Severity } from '../../risk/risk.types';

/** GET /api/findings/search?q=zeuz&severity=critical,high&currentOnly=true&page=1 */
export class SearchFindingsQueryDto {
  /** Free text: host, title, description or recommendation. Typos and partial words are fine. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q: string;

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
  @IsIn(RULES.map((r) => r.meta.id), { each: true })
  ruleId?: string[];

  /** Only findings from each asset's latest scan (default), like the Findings page's "Current only". */
  @IsOptional()
  @BooleanFromQuery()
  @IsBoolean()
  currentOnly: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 20;
}
