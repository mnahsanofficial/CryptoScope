import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { offsetOf, Paginated, toPaginated } from '../common/pagination';
import { ListFindingsQueryDto } from './dto/list-findings.query';
import { Finding } from './finding.entity';

@Injectable()
export class FindingsService {
  constructor(@InjectRepository(Finding) private readonly findings: Repository<Finding>) {}

  async list(query: ListFindingsQueryDto): Promise<Paginated<Finding>> {
    const dataQuery = this.buildListQuery(query);

    const [data, total] = await Promise.all([dataQuery.getMany(), this.count(query)]);
    return toPaginated(data, total, query);
  }

  /** Exposed for the EXPLAIN demo script, so it measures exactly the SQL the API runs. */
  buildListQuery(query: ListFindingsQueryDto): SelectQueryBuilder<Finding> {
    const qb = this.applyFilters(this.findings.createQueryBuilder('finding'), query)
      .leftJoin('finding.asset', 'asset')
      .addSelect(['asset.id', 'asset.host', 'asset.port', 'asset.label']);
    return this.applySort(qb, query).offset(offsetOf(query)).limit(query.pageSize);
  }

  /**
   * Plain COUNT(*) without the join or ORDER BY. (TypeORM's getCount() would emit COUNT(DISTINCT id),
   * which is slower and unnecessary here because the many-to-one join can't duplicate rows.)
   */
  private async count(query: ListFindingsQueryDto): Promise<number> {
    const row = await this.applyFilters(this.findings.createQueryBuilder('finding'), query)
      .select('COUNT(*)::int', 'count')
      .getRawOne<{ count: number }>();
    return row?.count ?? 0;
  }

  private applyFilters(qb: SelectQueryBuilder<Finding>, query: ListFindingsQueryDto): SelectQueryBuilder<Finding> {
    // Every value goes in as a bound parameter (:name), never concatenated into the SQL string.
    if (query.severity?.length) qb.andWhere('finding.severity IN (:...severities)', { severities: query.severity });
    if (query.category?.length) qb.andWhere('finding.category IN (:...categories)', { categories: query.category });
    if (query.ruleId?.length) qb.andWhere('finding.ruleId IN (:...ruleIds)', { ruleIds: query.ruleId });
    if (query.assetId) qb.andWhere('finding.assetId = :assetId', { assetId: query.assetId });
    if (query.from) qb.andWhere('finding.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('finding.createdAt < :to', { to: query.to });
    return qb;
  }

  private applySort(qb: SelectQueryBuilder<Finding>, query: ListFindingsQueryDto): SelectQueryBuilder<Finding> {
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    if (query.sort === 'severity') {
      // The enum is declared worst-first, so "most severe first" (desc) is ASC in SQL.
      qb.orderBy('finding.severity', direction === 'DESC' ? 'ASC' : 'DESC').addOrderBy('finding.createdAt', 'DESC');
    } else {
      qb.orderBy('finding.createdAt', direction);
    }
    // Tie-breaker so pages are stable; same direction as created_at so one index can serve the whole ORDER BY.
    return qb.addOrderBy('finding.id', direction);
  }
}
