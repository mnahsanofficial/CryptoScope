import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, errors, estypes } from '@elastic/elasticsearch';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Finding } from './finding.entity';

export const FINDINGS_INDEX = Symbol('FINDINGS_INDEX');

/**
 * Elasticsearch copy of the findings, for full-text search and fast dashboard aggregations.
 * PostgreSQL stays the source of truth; this index can always be rebuilt from it.
 */
export const FINDINGS_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    finding_id: { type: 'keyword' },
    scan_id: { type: 'keyword' },
    asset_id: { type: 'keyword' },
    host: { type: 'keyword' },
    port: { type: 'integer' },
    environment: { type: 'keyword' },
    rule_id: { type: 'keyword' },
    severity: { type: 'keyword' },
    category: { type: 'keyword' },
    title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
    description: { type: 'text' },
    recommendation: { type: 'text' },
    // Evidence keys differ per rule. "flattened" indexes the whole object as ONE field,
    // so new keys can never cause a "mapping explosion".
    evidence: { type: 'flattened' },
    risk_score: { type: 'short' },
    risk_level: { type: 'keyword' },
    created_at: { type: 'date' },
  },
};

@Injectable()
export class FindingsIndexer implements OnModuleInit {
  private readonly logger = new Logger(FindingsIndexer.name);

  constructor(
    private readonly es: Client,
    @Inject(FINDINGS_INDEX) private readonly index: string,
    @InjectRepository(Finding) private readonly findings: Repository<Finding>,
  ) {}

  /** Creates the index on startup if it doesn't exist. Never blocks startup if Elasticsearch is down. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndex();
    } catch (err) {
      this.logger.warn(`Could not create index ${this.index} yet: ${(err as Error).message}`);
    }
  }

  async ensureIndex(): Promise<void> {
    if (await this.es.indices.exists({ index: this.index })) return;
    try {
      await this.es.indices.create({
        index: this.index,
        mappings: FINDINGS_MAPPINGS,
        settings: { number_of_shards: 1, number_of_replicas: 0 },
      });
    } catch (err) {
      // Another instance created it at the same moment: that's fine.
      const alreadyExists =
        err instanceof errors.ResponseError && JSON.stringify(err.body).includes('resource_already_exists_exception');
      if (!alreadyExists) throw err;
    }
  }

  /**
   * Indexes all findings of one scan. Each document uses the finding's id as its Elasticsearch _id,
   * so indexing the same scan twice (a retried job) overwrites instead of duplicating.
   */
  async indexScan(scanId: string): Promise<number> {
    const rows = await this.findings
      .createQueryBuilder('finding')
      .innerJoinAndSelect('finding.asset', 'asset')
      .innerJoinAndSelect('finding.scan', 'scan')
      .where('finding.scanId = :scanId', { scanId })
      .getMany();
    if (rows.length === 0) return 0;

    await this.ensureIndex();
    const response = await this.es.bulk({
      operations: rows.flatMap((f) => [{ index: { _index: this.index, _id: f.id } }, toDocument(f)]),
    });

    // _bulk returns 200 even when single documents fail, so check every item.
    if (response.errors) {
      const firstError = response.items.find((item) => item.index?.error)?.index?.error;
      throw new Error(`Indexing findings of scan ${scanId} failed: ${firstError?.type}: ${firstError?.reason}`);
    }
    return rows.length;
  }
}

function toDocument(f: Finding) {
  return {
    finding_id: f.id,
    scan_id: f.scanId,
    asset_id: f.assetId,
    host: f.asset.host,
    port: f.asset.port,
    environment: f.asset.environment,
    rule_id: f.ruleId,
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    recommendation: f.recommendation,
    evidence: f.evidence,
    risk_score: f.scan.riskScore,
    risk_level: f.scan.riskLevel,
    created_at: f.createdAt,
  };
}
