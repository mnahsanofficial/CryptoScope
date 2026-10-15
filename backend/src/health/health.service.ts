import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../infra/redis.module';

export type DependencyName = 'postgres' | 'redis' | 'elasticsearch';

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  details?: string;
  error?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'error';
  timestamp: string;
  checks: Record<DependencyName, DependencyStatus>;
}

export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly elasticsearch: Client,
  ) {}

  /** Liveness: is this process running? Never touches dependencies. */
  liveness() {
    return {
      status: 'ok' as const,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: can this instance actually serve traffic? Checks every dependency in parallel. */
  async readiness(): Promise<ReadinessReport> {
    const [postgres, redis, elasticsearch] = await Promise.all([
      this.check(async () => {
        await this.dataSource.query('SELECT 1');
      }),
      this.check(async () => {
        await this.redis.ping();
      }),
      this.check(async () => {
        const health = await this.elasticsearch.cluster.health();
        // A single-node cluster is normally "yellow" (replicas can't be placed). Only "red" is a failure.
        if (health.status === 'red') {
          throw new Error('Cluster status is red');
        }
        return `cluster status ${health.status}`;
      }),
    ]);

    const checks = { postgres, redis, elasticsearch };
    const allUp = Object.values(checks).every((c) => c.status === 'up');

    return {
      status: allUp ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  // Never throws: every failure (error or timeout) becomes a "down" status.
  private async check(probe: () => Promise<string | void>): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      const details = await withTimeout(probe(), HEALTH_CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: Date.now() - start, ...(details ? { details } : {}) };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
