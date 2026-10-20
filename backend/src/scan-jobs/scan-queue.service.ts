import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, JobsOptions, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { Asset } from '../assets/asset.entity';
import { AppConfig } from '../config/configuration';
import { BatchTracker } from './batch-tracker.service';
import { SCAN_JOB, SCAN_QUEUE, ScanJobData, ScanJobResult, ScanProgress, STAGE_PERCENT } from './scan-job.types';

export interface EnqueuedJob {
  jobId: string;
  assetId: string;
  scanId: string;
  /** False when a scan for this asset was already waiting or running, so no new job was created. */
  created: boolean;
}

/** The producer side: turns "please scan" requests into jobs in Redis. */
@Injectable()
export class ScanQueueService {
  private readonly jobOptions: JobsOptions;

  constructor(
    @InjectQueue(SCAN_QUEUE) private readonly queue: Queue<ScanJobData, ScanJobResult>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly batches: BatchTracker,
    config: ConfigService,
  ) {
    const { scanAttempts, retryDelayMs } = config.getOrThrow<AppConfig['queue']>('queue');
    this.jobOptions = {
      attempts: scanAttempts,
      backoff: { type: 'exponential', delay: retryDelayMs }, // e.g. 2s, then 4s
      // Keep finished jobs for a while (for GET /scan-jobs/:id), but don't let Redis grow forever.
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 }, // failed jobs stay longer, for investigation
    };
  }

  async enqueueAsset(assetId: string): Promise<EnqueuedJob> {
    if (!(await this.assets.existsBy({ id: assetId }))) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }
    return this.add(assetId, null);
  }

  /** Enqueues one job per asset and tracks them together as a batch. */
  async enqueueBatch(assetIds: string[]): Promise<{ batchId: string; total: number; jobs: EnqueuedJob[] }> {
    const uniqueIds = [...new Set(assetIds)];
    const found = await this.assets.find({ select: { id: true }, where: { id: In(uniqueIds) } });
    const missing = uniqueIds.filter((id) => !found.some((a) => a.id === id));
    if (missing.length) {
      throw new BadRequestException(`Unknown asset ids: ${missing.join(', ')}`);
    }

    const batchId = randomUUID();
    // The counters must exist before the first worker can finish a job.
    await this.batches.create(batchId, uniqueIds.length);
    const jobs = await Promise.all(uniqueIds.map((id) => this.add(id, batchId)));

    // Assets that already had a scan waiting/running were not re-queued, so they aren't part of this batch.
    const skipped = jobs.filter((j) => !j.created).length;
    if (skipped) await this.batches.adjustTotal(batchId, -skipped);
    return { batchId, total: uniqueIds.length - skipped, jobs };
  }

  async getJob(jobId: string) {
    // State FIRST, then the job: BullMQ writes the result and the "completed" state in one atomic step, so a
    // job loaded after a finished state always has its result. The other order races with the worker: the job
    // could be loaded unfinished, finish, and then report "completed" with no result and 0 attempts.
    const state = await this.queue.getJobState(jobId);
    const job = await this.queue.getJob(jobId);
    if (!job || state === 'unknown') throw new NotFoundException(`Scan job ${jobId} not found (it may have expired)`);
    return {
      id: job.id,
      state,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
      createdAt: new Date(job.timestamp).toISOString(),
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }

  async getBatch(batchId: string) {
    const batch = await this.batches.get(batchId);
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found (it may have expired)`);
    return batch;
  }

  /** How many jobs are waiting, running, delayed (waiting to retry), completed and failed. */
  counts() {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  }

  private async add(assetId: string, batchId: string | null): Promise<EnqueuedJob> {
    const scanId = randomUUID();
    const job: Job<ScanJobData, ScanJobResult> = await this.queue.add(
      SCAN_JOB,
      { assetId, scanId, batchId },
      {
        ...this.jobOptions,
        jobId: scanId, // job id = future scan id, easy to follow from API to database
        // While a scan for this asset is waiting or running, a second request reuses it instead of
        // scanning the same host twice in parallel.
        deduplication: { id: `asset:${assetId}` },
      },
    );

    const created = job.id === scanId;
    if (!created) {
      // Deduplicated: BullMQ returns the EXISTING job's id, but this object still holds our new data.
      const existing = await this.queue.getJob(job.id!);
      return { jobId: job.id!, assetId, scanId: existing?.data.scanId ?? job.id!, created: false };
    }
    const queued: ScanProgress = {
      jobId: scanId,
      assetId,
      scanId,
      batchId,
      stage: 'queued',
      percent: STAGE_PERCENT.queued,
      attempt: 0,
      maxAttempts: this.jobOptions.attempts ?? 1,
    };
    await job.updateProgress(queued); // published to every API instance via Redis
    return { jobId: scanId, assetId, scanId, created: true };
  }
}
