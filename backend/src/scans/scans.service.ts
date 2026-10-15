import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { offsetOf, Paginated, PaginationQueryDto, toPaginated } from '../common/pagination';
import { Finding } from '../findings/finding.entity';
import { RiskEngine } from '../risk/risk-engine';
import { toScanError } from '../scanner/scan-error';
import { CertificateInfo } from '../scanner/scanner.types';
import { TlsScannerService } from '../scanner/tls-scanner.service';
import { Certificate } from './certificate.entity';
import { Scan } from './scan.entity';
import { toCertificateRow, toFailedScanRow, toFindingRows, toSuccessfulScanRow } from './scan.mapper';

@Injectable()
export class ScansService {
  private readonly logger = new Logger(ScansService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(Scan) private readonly scans: Repository<Scan>,
    private readonly scanner: TlsScannerService,
    private readonly riskEngine: RiskEngine,
  ) {}

  /**
   * Scans an asset now and stores the result. A failed scan is still recorded (with its error code),
   * because "we could not reach it" is useful history too.
   * Synchronous for now; Step 6 moves this into a BullMQ worker.
   */
  async scanAsset(assetId: string): Promise<Scan> {
    const asset = await this.assets.findOneBy({ id: assetId });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    const scanId = randomUUID();
    const scannedAt = new Date();

    // The network call happens OUTSIDE the transaction: never hold a DB transaction open while waiting on I/O.
    let outcome: Awaited<ReturnType<TlsScannerService['scan']>> | null = null;
    let failure: ReturnType<typeof toScanError> | null = null;
    try {
      outcome = await this.scanner.scan({ host: asset.host, port: asset.port });
    } catch (err) {
      failure = toScanError(err);
      this.logger.warn(`Scan of ${asset.host}:${asset.port} failed: [${failure.code}] ${failure.message}`);
    }
    const durationMs = Date.now() - scannedAt.getTime();

    // All writes succeed together or not at all.
    await this.dataSource.transaction(async (em) => {
      if (outcome) {
        const risk = this.riskEngine.assess(outcome, scannedAt);
        const certificateId = await this.upsertCertificate(em, outcome.certificate);
        await em.insert(Scan, toSuccessfulScanRow({ id: scanId, assetId, scannedAt, durationMs, certificateId }, outcome, risk));
        const findings = toFindingRows({ scanId, assetId }, risk, scannedAt, randomUUID);
        if (findings.length) await em.insert(Finding, findings);
        await em.update(Asset, assetId, {
          lastScannedAt: scannedAt,
          latestRiskScore: risk.score,
          latestRiskLevel: risk.level,
        });
      } else if (failure) {
        await em.insert(Scan, toFailedScanRow({ id: scanId, assetId, scannedAt, durationMs }, failure));
        // Keep the last known risk: a timeout doesn't make a host safer or riskier.
        await em.update(Asset, assetId, { lastScannedAt: scannedAt });
      }
    });

    return this.findOne(scanId);
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
