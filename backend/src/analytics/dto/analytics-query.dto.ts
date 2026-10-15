import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../../common/pagination';

/** ?from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z (defaults to the last 7 days). */
export class TimeRangeQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export const HISTOGRAM_INTERVALS = ['1h', '3h', '6h', '12h', '1d'] as const;

export class WeakPerIntervalQueryDto extends TimeRangeQueryDto {
  @IsOptional()
  @IsIn(HISTOGRAM_INTERVALS)
  interval: (typeof HISTOGRAM_INTERVALS)[number] = '1h';
}

export class TopHostsQueryDto extends TimeRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

/** Elasticsearch refuses from + size > 10,000 by default (index.max_result_window). */
export const MAX_RESULT_WINDOW = 10_000;

export class SearchHandshakesQueryDto extends TimeRangeQueryDto {
  /** Free text matched against user_agent, e.g. "msie" or "java". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'])
  tlsVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string;

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
