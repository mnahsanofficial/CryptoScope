/** Shared setup for the e2e tests that boot the whole app. */
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NestExpressApplication } from '@nestjs/platform-express';
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
  process.env.SCAN_ALLOW_PRIVATE_TARGETS = 'true'; // the test TLS servers run on 127.0.0.1
  process.env.RATE_LIMIT = '100000'; // tests poll a lot; the strict login limit is tested on its own
}

export interface TestTokens {
  admin: string;
  viewer: string;
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

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

/**
 * Boots the real AppModule (migrations, worker, Socket.IO) against the test environment,
 * and creates one admin and one viewer with ready-to-use tokens.
 */
export async function bootTestApp(): Promise<{ app: INestApplication; db: DataSource; url: string; tokens: TestTokens }> {
  await ensureTestDatabase();
  useTestEnvironment();

  // Imported after the env is set, because the config is read when the module is evaluated.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app.setup');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1'); // a real port, so Socket.IO clients can connect

  const { port } = app.getHttpServer().address() as AddressInfo;
  const db = app.get(DataSource);
  return { app, db, url: `http://127.0.0.1:${port}`, tokens: await createTestUsers(app, db) };
}

async function createTestUsers(app: INestApplication, db: DataSource): Promise<TestTokens> {
  const { UsersService } = await import('../src/users/users.service');
  const { AuthService } = await import('../src/auth/auth.service');
  await db.query('TRUNCATE users');
  const users = app.get(UsersService);
  const auth = app.get(AuthService);
  await users.create('admin@test.local', TEST_PASSWORD, 'admin');
  await users.create('viewer@test.local', TEST_PASSWORD, 'viewer');
  // Tokens are issued directly (not via HTTP) so the strict login rate limit isn't used up here.
  return {
    admin: (await auth.login('admin@test.local', TEST_PASSWORD)).accessToken,
    viewer: (await auth.login('viewer@test.local', TEST_PASSWORD)).accessToken,
  };
}

/** supertest with the Authorization header already set. */
export function client(app: INestApplication, token?: string) {
  const withAuth = (req: request.Test) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  const server = () => request(app.getHttpServer());
  return {
    get: (url: string) => withAuth(server().get(url)),
    post: (url: string) => withAuth(server().post(url)),
    patch: (url: string) => withAuth(server().patch(url)),
    delete: (url: string) => withAuth(server().delete(url)),
  };
}

/** Removes everything the tests put in Redis: all jobs of the test queue and the batch counters. */
export async function cleanUpTestQueue(app: INestApplication): Promise<void> {
  const { REDIS_CLIENT } = await import('../src/infra/redis.module');
  await app.get<Queue>(getQueueToken('scans')).obliterate({ force: true });
  const redis = app.get<Redis>(REDIS_CLIENT);
  await deleteKeys(redis, `${process.env.QUEUE_PREFIX}:scan-batch:*`);
  await clearRateLimits(app);
}

/** Resets the rate-limit counters (stored in Redis) of the test prefix. */
export async function clearRateLimits(app: INestApplication): Promise<void> {
  const { REDIS_CLIENT } = await import('../src/infra/redis.module');
  await deleteKeys(app.get<Redis>(REDIS_CLIENT), `${process.env.QUEUE_PREFIX}:throttle:*`);
}

async function deleteKeys(redis: Redis, pattern: string): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(...keys);
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
export async function waitForJob(app: INestApplication, token: string, jobId: string, timeoutMs = 15_000): Promise<FinishedJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await client(app, token).get(`/api/scan-jobs/${jobId}`).expect(200);
    if (body.state === 'completed' || body.state === 'failed') return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

/** Enqueues a scan (202), waits for the worker, and returns the job plus the stored scan. */
export async function scanAndWait(app: INestApplication, adminToken: string, assetId: string) {
  const api = client(app, adminToken);
  const { body: enqueued } = await api.post(`/api/assets/${assetId}/scans`).expect(202);
  const job = await waitForJob(app, adminToken, enqueued.jobId);
  const scan = job.state === 'completed' ? (await api.get(`/api/scans/${enqueued.scanId}`).expect(200)).body : null;
  return { enqueued, job, scan };
}
