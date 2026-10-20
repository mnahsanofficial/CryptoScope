import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../common/pagination';

/** Query strings are text: "true"/"false" must be turned into real booleans before validation. */
export const BooleanFromQuery = () =>
  Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value));

export class ExpiringCertificatesQueryDto extends PaginationQueryDto {
  /** Certificates that expire within this many days. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;

  /** Also list certificates that have already expired (they are the most urgent). */
  @IsOptional()
  @BooleanFromQuery()
  @IsBoolean()
  includeExpired: boolean = true;

  /** false = real hosts only, true = seeded demo hosts only, absent = both. */
  @IsOptional()
  @BooleanFromQuery()
  @IsBoolean()
  synthetic?: boolean;

  /** Soonest expiry first by default: that's the most urgent. */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override order: 'asc' | 'desc' = 'asc';
}
