import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scan } from '../scans/scan.entity';
import { Finding } from './finding.entity';
import { FINDINGS_MAPPINGS, FINDINGS_SETTINGS, toFindingDocument, versionedIndexName } from './findings-index';

export const FINDINGS_INDEX = Symbol('FINDINGS_INDEX');

/** Writes findings into Elasticsearch as the scan worker produces them. */
@Injectable()
export class FindingsIndexer implements OnModuleInit {
  private readonly logger = new Logger(FindingsIndexer.name);

  constructor(
    private readonly es: Client,
    @Inject(FINDINGS_INDEX) private readonly alias: string,
    @InjectRepository(Finding) private readonly findings: Repository<Finding>,
  ) {}

  /** Creates the index on startup if needed. Never blocks startup if Elasticsearch is down. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndex();
    } catch (err) {
      this.logger.warn(`Could not prepare index ${this.alias} yet: ${(err as Error).message}`);
    }
  }

  /** First start: create a versioned index behind the alias. Existing setups are left alone. */
  async ensureIndex(): Promise<void> {
    if (await this.es.indices.exists({ index: this.alias })) return; // alias (or a legacy index) already there
    try {
      await this.es.indices.create({
        index: versionedIndexName(this.alias),
        settings: FINDINGS_SETTINGS,
        mappings: FINDINGS_MAPPINGS,
        aliases: { [this.alias]: { is_write_index: true } },
      });
    } catch (err) {
      // Another instance created it at the same moment: that's fine.
      const alreadyExists =
        err instanceof errors.ResponseError && JSON.stringify(err.body).includes('resource_already_exists_exception');
      if (!alreadyExists) throw err;
    }
  }

  /**
   * Indexes all findings of one scan. Each document uses the finding's id as its Elasticsearch _id, so
   * indexing the same scan twice (a retried job) overwrites instead of duplicating.
   * A successful scan also becomes the asset's current state, so the asset's older findings are marked
   * is_current = false (even when the new scan has no findings at all, e.g. the host was fixed).
   */
  async indexScan(scanId: string): Promise<number> {
    const scan = await this.findings.manager.findOneBy(Scan, { id: scanId });
    if (!scan || scan.status !== 'success') return 0; // failed scans have no findings and change nothing

    await this.ensureIndex();
    const rows = await this.findings
      .createQueryBuilder('finding')
      .innerJoinAndSelect('finding.asset', 'asset')
      .innerJoinAndSelect('finding.scan', 'scan')
      .where('finding.scanId = :scanId', { scanId })
      .getMany();

    if (rows.length > 0) {
      const response = await this.es.bulk({
        // Searchable before the job reports "completed", so a UI that reloads on that event sees them.
        refresh: 'wait_for',
        operations: rows.flatMap((f) => [{ index: { _index: this.alias, _id: f.id } }, toFindingDocument(f, true)]),
      });
      // _bulk returns 200 even when single documents fail, so check every item.
      if (response.errors) {
        const firstError = response.items.find((item) => item.index?.error)?.index?.error;
        throw new Error(`Indexing findings of scan ${scanId} failed: ${firstError?.type}: ${firstError?.reason}`);
      }
    }

    // Older findings of this asset are history now. Idempotent, so safe on retries.
    await this.es.updateByQuery({
      index: this.alias,
      conflicts: 'proceed',
      refresh: true,
      query: {
        bool: {
          filter: [{ term: { asset_id: scan.assetId } }, { term: { is_current: true } }],
          must_not: [{ term: { scan_id: scanId } }],
        },
      },
      script: { source: 'ctx._source.is_current = false', lang: 'painless' },
    });
    return rows.length;
  }
}
