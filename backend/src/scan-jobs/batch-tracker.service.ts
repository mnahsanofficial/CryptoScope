import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';
import { REDIS_CLIENT } from '../infra/redis.module';
import { BatchProgress } from './scan-job.types';

const BATCH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Counts finished jobs per batch in a Redis hash: { total, completed, failed }.
 * HINCRBY is atomic, so many workers finishing at the same moment can't lose an update.
 */
@Injectable()
export class BatchTracker {
  private readonly prefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.prefix = config.getOrThrow<AppConfig['queue']>('queue').prefix;
  }

  async create(batchId: string, total: number): Promise<void> {
    await this.redis
      .multi()
      .hset(this.key(batchId), { total, completed: 0, failed: 0 })
      .expire(this.key(batchId), BATCH_TTL_SECONDS)
      .exec();
  }

  async adjustTotal(batchId: string, delta: number): Promise<void> {
    await this.redis.hincrby(this.key(batchId), 'total', delta);
  }

  /** Records one finished job and returns the batch's new totals. */
  async markFinished(batchId: string, outcome: 'completed' | 'failed'): Promise<BatchProgress> {
    const results = await this.redis
      .multi()
      .hincrby(this.key(batchId), outcome, 1)
      .hgetall(this.key(batchId))
      .exec();
    const values = (results?.[1]?.[1] ?? {}) as Record<string, string>;
    return toProgress(batchId, values);
  }

  async get(batchId: string): Promise<BatchProgress | null> {
    const values = await this.redis.hgetall(this.key(batchId));
    return values.total ? toProgress(batchId, values) : null;
  }

  private key(batchId: string): string {
    return `${this.prefix}:scan-batch:${batchId}`;
  }
}

function toProgress(batchId: string, values: Record<string, string>): BatchProgress {
  const total = Number(values.total ?? 0);
  const completed = Number(values.completed ?? 0);
  const failed = Number(values.failed ?? 0);
  return {
    batchId,
    total,
    completed,
    failed,
    percent: total === 0 ? 100 : Math.round(((completed + failed) / total) * 100), // nothing to do = done
  };
}
