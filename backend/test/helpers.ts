/** Shared setup for the e2e tests that boot the whole app. */
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { config as loadDotenv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { AddressInfo, createServer } from 'node:net';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { Client } from 'pg';
import request from 'supertest';
import { DataSource } from 'typeorm';

export const TEST_DB = 'cryptoscope_test';
export const TEST_FINDINGS_INDEX = 'cryptoscope-findings-test';

loadDotenv({ path: [join(__dirname, '../.env'), join(__dirname, '../../.env')], quiet: true });

/**
 * Isolates tests from the dev stack: own database, own BullMQ prefix (so the dev worker never
 * picks up test jobs), own Elasticsearch index, and short timeouts/retry delays.
 */
function useTestEnvironment(): void {
  process.env.POSTGRES_DB = TEST_DB;
  process.env.QUEUE_PREFIX = 'cryptoscope-test';
  process.env.FINDINGS_INDEX = TEST_FINDINGS_INDEX;
  process.env.SCAN_TIMEOUT_MS = '2000';
  process.env.SCAN_RETRY_DELAY_MS = '100';
  process.env.SCAN_JOB_ATTEMPTS = '3';
}

/** Creates the test database if needed (CREATE DATABASE can't use IF NOT EXISTS). */
async function ensureTestDatabase(): Promise<void> {
  const admin = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (!rowCount) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}

/** Boots the real AppModule (migrations, worker, Socket.IO) against the test environment. */
export async function bootTestApp(): Promise<{ app: INestApplication; db: DataSource; url: string }> {
  await ensureTestDatabase();
  useTestEnvironment();

  // Imported after the env is set, because the config is read when the module is evaluated.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app.setup');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1'); // a real port, so Socket.IO clients can connect

  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, db: app.get(DataSource), url: `http://127.0.0.1:${port}` };
}

/** Removes everything the tests put in Redis: all jobs of the test queue and the batch counters. */
export async function cleanUpTestQueue(app: INestApplication): Promise<void> {
  const { REDIS_CLIENT } = await import('../src/infra/redis.module');
  await app.get<Queue>(getQueueToken('scans')).obliterate({ force: true });
  const redis = app.get<Redis>(REDIS_CLIENT);
  const batchKeys = await redis.keys(`${process.env.QUEUE_PREFIX}:scan-batch:*`);
  if (batchKeys.length) await redis.del(...batchKeys);
}

/** Local TLS server with the self-signed RSA-2048 test certificate and classical-only key exchange. */
export async function startTlsServer(): Promise<{ port: number; server: tls.Server }> {
  const fixtures = join(__dirname, '../src/scanner/__fixtures__');
  const server = tls.createServer(
    {
      key: readFileSync(join(fixtures, 'rsa2048-sha256.key')),
      cert: readFileSync(join(fixtures, 'rsa2048-sha256.crt')),
      ecdhCurve: 'X25519', // no hybrid PQ group -> NO_PQ_KEY_EXCHANGE finding
    },
    (socket) => socket.end(),
  );
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}

/** A port with nothing listening on it. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export interface FinishedJob {
  id: string;
  state: string;
  attemptsMade: number;
  result: { scanId: string; status: string } | null;
  failedReason: string | null;
}

/** Polls GET /api/scan-jobs/:id until the job is completed or failed. */
export async function waitForJob(app: INestApplication, jobId: string, timeoutMs = 15_000): Promise<FinishedJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await request(app.getHttpServer()).get(`/api/scan-jobs/${jobId}`).expect(200);
    if (body.state === 'completed' || body.state === 'failed') return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

/** Enqueues a scan (202), waits for the worker, and returns the job plus the stored scan. */
export async function scanAndWait(app: INestApplication, assetId: string) {
  const api = request(app.getHttpServer());
  const { body: enqueued } = await api.post(`/api/assets/${assetId}/scans`).expect(202);
  const job = await waitForJob(app, enqueued.jobId);
  const scan = job.state === 'completed' ? (await api.get(`/api/scans/${enqueued.scanId}`).expect(200)).body : null;
  return { enqueued, job, scan };
}
