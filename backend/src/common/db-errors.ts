import { QueryFailedError } from 'typeorm';

// https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string }).code === UNIQUE_VIOLATION;
}
