import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListFindingsQueryDto } from '../findings/dto/list-findings.query';
import { escapeLike, offsetOf, toPaginated } from './pagination';

/** Mimics what Nest's ValidationPipe does with a raw query string object. */
async function parseQuery(raw: Record<string, unknown>) {
  const dto = plainToInstance(ListFindingsQueryDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors: errors.map((e) => e.property) };
}

describe('pagination helpers', () => {
  it('computes offsets and page metadata', () => {
    const query = { page: 3, pageSize: 20, order: 'desc' as const };
    expect(offsetOf(query)).toBe(40);
    expect(toPaginated(['a'], 41, query).meta).toEqual({ page: 3, pageSize: 20, total: 41, totalPages: 3 });
  });

  it('escapes LIKE wildcards so user input matches literally', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
  });
});

describe('ListFindingsQueryDto', () => {
  it('applies defaults when nothing is given', async () => {
    const { dto, errors } = await parseQuery({});
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ page: 1, pageSize: 20, order: 'desc', sort: 'createdAt' });
  });

  it('converts query-string numbers and splits comma-separated lists', async () => {
    const { dto, errors } = await parseQuery({ page: '2', pageSize: '50', severity: 'critical,high' });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ page: 2, pageSize: 50, severity: ['critical', 'high'] });
  });

  it('accepts repeated parameters (?severity=a&severity=b)', async () => {
    const { dto } = await parseQuery({ severity: ['critical', 'low'] });
    expect(dto.severity).toEqual(['critical', 'low']);
  });

  it.each([
    [{ severity: 'urgent' }, 'severity'],
    [{ pageSize: '1000' }, 'pageSize'],
    [{ page: '0' }, 'page'],
    [{ sort: 'title; DROP TABLE findings' }, 'sort'],
    [{ assetId: 'not-a-uuid' }, 'assetId'],
    [{ from: 'yesterday' }, 'from'],
    [{ ruleId: 'MADE_UP_RULE' }, 'ruleId'],
    [{ unexpected: 'x' }, 'unexpected'],
  ])('rejects %o', async (raw, property) => {
    const { errors } = await parseQuery(raw);
    expect(errors).toContain(property);
  });
});
