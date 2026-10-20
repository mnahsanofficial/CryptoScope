import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { AppConfig } from '../config/configuration';
import { FindingsIndexer } from '../findings/findings-indexer.service';
import { RETRYABLE_SCAN_ERRORS, ScanError, toScanError } from '../scanner/scan-error';
import { TlsScanResult } from '../scanner/scanner.types';
import { TlsScannerService } from '../scanner/tls-scanner.service';
import { ScansService } from '../scans/scans.service';
import { BatchTracker } from './batch-tracker.service';
import { SCAN_QUEUE, ScanJobData, ScanJobResult, ScanProgress, ScanStage, STAGE_PERCENT } from './scan-job.types';

/**
 * The worker: takes scan jobs from Redis and runs them. Pipeline per job:
 *   scanning (TLS handshake) -> saving (Postgres transaction) -> indexing (Elasticsearch) -> completed
 *
 * Failure handling:
 *  - Network problems that may be temporary (timeout, refused, reset) -> throw, BullMQ retries with
 *    exponential backoff. On the LAST attempt we stop retrying and save it as a failed scan instead.
 *  - Problems that won't change (DNS name doesn't exist, TLS handshake impossible) -> saved as a failed
 *    scan right away. Retrying would only waste time.
 *  - Infrastructure errors (Postgres/Elasticsearch down) -> throw, retried; after the last attempt the
 *    job stays in BullMQ's "failed" set for investigation (a dead-letter queue).
 *  - Asset deleted meanwhile -> UnrecoverableError: BullMQ fails the job without retrying.
 */
@Processor(SCAN_QUEUE)
export class ScanProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ScanProcessor.name);

  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly scanner: TlsScannerService,
    private readonly scans: ScansService,
    private readonly indexer: FindingsIndexer,
    private readonly batches: BatchTracker,
    private readonly config: ConfigService,
  ) {
    super();
  }

  onModuleInit(): void {
    // Set at runtime because the @Processor decorator can't read config.
    this.worker.concurrency = this.config.getOrThrow<AppConfig['queue']>('queue').workerConcurrency;
  }

  async process(job: Job<ScanJobData, ScanJobResult>): Promise<ScanJobResult> {
    const { assetId, scanId } = job.data;
    const attempt = job.attemptsMade + 1; // attemptsMade counts previous, finished attempts
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = attempt >= maxAttempts;

    try {
      const asset = await this.assets.findOneBy({ id: assetId });
      if (!asset) throw new UnrecoverableError(`Asset ${assetId} no longer exists`);

      // A previous attempt may have saved the scan and then failed while indexing: don't scan again.
      if (!(await this.scans.exists(scanId))) {
        await this.report(job, 'scanning', `Connecting to ${asset.host}:${asset.port}`);
        const scannedAt = new Date();
        const outcome = await this.scanOrDecide(asset, isLastAttempt);
        await this.report(job, 'saving');
        await this.scans.recordScan({ scanId, assetId, scannedAt, durationMs: Date.now() - scannedAt.getTime(), outcome });
      }

      await this.report(job, 'indexing');
      const findingsIndexed = await this.indexer.indexScan(scanId);

      const scan = await this.scans.findOne(scanId);
      const result: ScanJobResult = {
        scanId,
        status: scan.status,
        riskScore: scan.riskScore,
        riskLevel: scan.riskLevel,
        errorCode: scan.errorCode,
        findingsIndexed,
      };
      const batch = job.data.batchId ? await this.batches.markFinished(job.data.batchId, 'completed') : undefined;
      await this.report(job, 'completed', summarise(asset, result), { result, batch });
      return result;
    } catch (err) {
      const willRetry = !(err instanceof UnrecoverableError) && !isLastAttempt;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Scan job ${job.id} attempt ${attempt}/${maxAttempts} failed: ${message}`);
      try {
        const batch =
          !willRetry && job.data.batchId ? await this.batches.markFinished(job.data.batchId, 'failed') : undefined;
        const nextIn = willRetry ? ` Retrying in ${this.retryDelayMs(job) / 1000}s.` : '';
        await this.report(job, willRetry ? 'retrying' : 'failed', `${message}${nextIn}`, { batch });
      } catch (reportErr) {
        // Never hide the real error because progress reporting failed (e.g. Redis blip).
        this.logger.error(`Could not report failure of job ${job.id}: ${(reportErr as Error).message}`);
      }
      throw err; // BullMQ decides: retry (with backoff) or move to "failed"
    }
  }

  /**
   * Runs the TLS scan. Returns the result, or a ScanError to SAVE as a failed scan.
   * Throws (so BullMQ retries) only for temporary network errors when attempts are left.
   */
  private async scanOrDecide(asset: Asset, isLastAttempt: boolean): Promise<TlsScanResult | ScanError> {
    try {
      return await this.scanner.scan({ host: asset.host, port: asset.port });
    } catch (err) {
      const error = toScanError(err);
      if (RETRYABLE_SCAN_ERRORS.has(error.code) && !isLastAttempt) throw error;
      return error;
    }
  }

  /** Exponential backoff: delay * 2^(attempts already made - 1). Used only for the progress message. */
  private retryDelayMs(job: Job): number {
    const backoff = job.opts.backoff;
    const base = typeof backoff === 'object' ? (backoff.delay ?? 0) : (backoff ?? 0);
    return base * Math.pow(2, job.attemptsMade);
  }

  private async report(
    job: Job<ScanJobData, ScanJobResult>,
    stage: ScanStage,
    message?: string,
    extra: Pick<ScanProgress, 'result' | 'batch'> = {},
  ): Promise<void> {
    const progress: ScanProgress = {
      jobId: job.id!,
      assetId: job.data.assetId,
      scanId: job.data.scanId,
      batchId: job.data.batchId,
      stage,
      percent: STAGE_PERCENT[stage],
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
      ...(message ? { message } : {}),
      ...extra,
    };
    await job.updateProgress(progress);
  }
}

function summarise(asset: Asset, result: ScanJobResult): string {
  return result.status === 'success'
    ? `${asset.host}: risk ${result.riskScore} (${result.riskLevel}), ${result.findingsIndexed} ${result.findingsIndexed === 1 ? 'finding' : 'findings'}`
    : `${asset.host}: unreachable (${result.errorCode})`;
}
