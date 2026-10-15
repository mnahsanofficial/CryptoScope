import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 100;

/** ?page=2&pageSize=50. Query strings are always strings, so @Type converts them to numbers. */
export class PaginationQueryDto {
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

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function toPaginated<T>(data: T[], total: number, { page, pageSize }: PaginationQueryDto): Paginated<T> {
  return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export function offsetOf({ page, pageSize }: PaginationQueryDto): number {
  return (page - 1) * pageSize;
}

/** Accepts both ?severity=high&severity=critical and ?severity=high,critical. */
export const CommaSeparated = () =>
  Transform(({ value }: { value: unknown }) => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim())
      .filter(Boolean);
  });

/** Escapes % and _ so user input is matched literally inside ILIKE patterns. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}
