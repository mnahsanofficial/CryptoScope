import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../common/db-errors';
import { escapeLike, offsetOf, Paginated, toPaginated } from '../common/pagination';
import { ScanError } from '../scanner/scan-error';
import { parseTarget } from '../scanner/scan-target';
import { Asset } from './asset.entity';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset.dto';
import { parseHostSearch } from './host-search';

// Whitelist: user input picks a key, never a raw column name (prevents SQL injection via ?sort=).
const SORT_COLUMNS: Record<ListAssetsQueryDto['sort'], string> = {
  riskScore: 'asset.latestRiskScore',
  host: 'asset.host',
  lastScannedAt: 'asset.lastScannedAt',
  createdAt: 'asset.createdAt',
};

@Injectable()
export class AssetsService {
  constructor(@InjectRepository(Asset) private readonly assets: Repository<Asset>) {}

  async create(dto: CreateAssetDto): Promise<Asset> {
    const { host, port } = this.normaliseTarget(dto.host, dto.port);
    try {
      return await this.assets.save(this.assets.create({ ...dto, host, port }));
    } catch (err) {
      throw this.translateError(err, host, port);
    }
  }

  async list(query: ListAssetsQueryDto): Promise<Paginated<Asset>> {
    const qb = this.assets.createQueryBuilder('asset');

    if (query.search) {
      // Accepts what people paste: "https://qa.zeuz.ai/" searches for host "qa.zeuz.ai".
      const { host, port } = parseHostSearch(query.search);
      if (host) qb.andWhere('asset.host ILIKE :search', { search: `%${escapeLike(host)}%` });
      if (port) qb.andWhere('asset.port = :port', { port });
    }
    if (query.riskLevel?.length) {
      qb.andWhere('asset.latestRiskLevel IN (:...riskLevels)', { riskLevels: query.riskLevel });
    }
    if (query.environment) {
      qb.andWhere('asset.environment = :environment', { environment: query.environment });
    }

    const [data, total] = await qb
      .orderBy(SORT_COLUMNS[query.sort], query.order === 'asc' ? 'ASC' : 'DESC', 'NULLS LAST')
      .addOrderBy('asset.id') // tie-breaker: without it, rows with equal values can jump between pages
      .offset(offsetOf(query))
      .limit(query.pageSize)
      .getManyAndCount();

    return toPaginated(data, total, query);
  }

  async findOne(id: string): Promise<Asset> {
    const asset = await this.assets.findOneBy({ id });
    if (!asset) throw new NotFoundException(`Asset ${id} not found`);
    return asset;
  }

  async update(id: string, dto: UpdateAssetDto): Promise<Asset> {
    const asset = await this.findOne(id);
    const { host, port } = this.normaliseTarget(dto.host ?? asset.host, dto.port ?? asset.port);
    try {
      return await this.assets.save(this.assets.merge(asset, { ...dto, host, port }));
    } catch (err) {
      throw this.translateError(err, host, port);
    }
  }

  /** Deleting an asset cascades to its scans and findings (ON DELETE CASCADE). */
  async remove(id: string): Promise<void> {
    const result = await this.assets.delete({ id });
    if (!result.affected) throw new NotFoundException(`Asset ${id} not found`);
  }

  private normaliseTarget(host: string, port?: number): { host: string; port: number } {
    try {
      return parseTarget(port ? `${host}:${port}` : host);
    } catch (err) {
      if (err instanceof ScanError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private translateError(err: unknown, host: string, port: number): unknown {
    if (isUniqueViolation(err)) {
      return new ConflictException(`Asset ${host}:${port} already exists`);
    }
    return err;
  }
}
