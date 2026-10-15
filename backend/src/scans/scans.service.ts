import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { offsetOf, Paginated, PaginationQueryDto, toPaginated } from '../common/pagination';
import { Finding } from '../findings/finding.entity';
import { RiskEngine } from '../risk/risk-engine';
import { ScanError } from '../scanner/scan-error';
import { CertificateInfo, TlsScanResult } from '../scanner/scanner.types';
import { Certificate } from './certificate.entity';
import { Scan } from './scan.entity';
import { toCertificateRow, toFailedScanRow, toFindingRows, toSuccessfulScanRow } from './scan.mapper';

export interface RecordScanInput {
  scanId: string;
  assetId: string;
  scannedAt: Date;
  durationMs: number;
  /** What the scanner returned, or why it failed. */
  outcome: TlsScanResult | ScanError;
}

@Injectable()
export class ScansService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(Scan) private readonly scans: Repository<Scan>,
    private readonly riskEngine: RiskEngine,
  ) {}

  /**
   * Stores the result of one scan: the scan row, its (deduplicated) certificate, its findings and the
   * asset's latest risk, all in ONE transaction. A failed scan is recorded too, because "we could not
   * reach it" is useful history.
   *
   * Idempotent: if a scan with this id already exists, nothing happens. A retried job can safely call
   * this again after a crash between "saved" and "indexed".
   */
  async recordScan(input: RecordScanInput): Promise<'recorded' | 'already-recorded'> {
    const { scanId, assetId, scannedAt, durationMs, outcome } = input;

    return this.dataSource.transaction(async (em) => {
      if (await em.existsBy(Scan, { id: scanId })) return 'already-recorded';

      if (outcome instanceof ScanError) {
        await em.insert(Scan, toFailedScanRow({ id: scanId, assetId, scannedAt, durationMs }, outcome));
        // Keep the last known risk: a timeout doesn't make a host safer or riskier.
        await em.update(Asset, assetId, { lastScannedAt: scannedAt });
        return 'recorded';
      }

      const risk = this.riskEngine.assess(outcome, scannedAt);
      const certificateId = await this.upsertCertificate(em, outcome.certificate);
      await em.insert(Scan, toSuccessfulScanRow({ id: scanId, assetId, scannedAt, durationMs, certificateId }, outcome, risk));
      const findings = toFindingRows({ scanId, assetId }, risk, scannedAt, randomUUID);
      if (findings.length) await em.insert(Finding, findings);
      await em.update(Asset, assetId, {
        lastScannedAt: scannedAt,
        latestRiskScore: risk.score,
        latestRiskLevel: risk.level,
        latestScanId: scanId,
      });
      return 'recorded';
    });
  }

  /**
   * Inserts the certificate, or returns the existing row if we've seen this fingerprint before.
   * ON CONFLICT makes this atomic, so two concurrent scans of the same cert can't create duplicates.
   * The no-op "DO UPDATE" (instead of DO NOTHING) is what makes RETURNING give us the existing id.
   */
  private async upsertCertificate(em: EntityManager, cert: CertificateInfo): Promise<string> {
    const result = await em
      .createQueryBuilder()
      .insert()
      .into(Certificate)
      .values(toCertificateRow(cert))
      .orUpdate(['fingerprint_sha256'], ['fingerprint_sha256'])
      .returning(['id'])
      .execute();
    return (result.raw as Array<{ id: string }>)[0].id;
  }

  exists(id: string): Promise<boolean> {
    return this.scans.existsBy({ id });
  }

  async findOne(id: string): Promise<Scan> {
    const scan = await this.scans
      .createQueryBuilder('scan')
      .leftJoinAndSelect('scan.certificate', 'certificate')
      .leftJoinAndSelect('scan.findings', 'finding')
      .where('scan.id = :id', { id })
      .orderBy('finding.severity', 'ASC') // enum order: critical first
      .getOne();
    if (!scan) throw new NotFoundException(`Scan ${id} not found`);
    return scan;
  }

  /** Scan history for one asset, newest first (served by idx_scans_asset_id_scanned_at). */
  async listForAsset(assetId: string, query: PaginationQueryDto): Promise<Paginated<Scan>> {
    if (!(await this.assets.existsBy({ id: assetId }))) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }
    const [data, total] = await this.scans
      .createQueryBuilder('scan')
      .where('scan.assetId = :assetId', { assetId })
      .orderBy('scan.scannedAt', query.order === 'asc' ? 'ASC' : 'DESC')
      .addOrderBy('scan.id')
      .offset(offsetOf(query))
      .limit(query.pageSize)
      .getManyAndCount();
    return toPaginated(data, total, query);
  }
}
