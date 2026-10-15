/**
 * End-to-end tests for the async scan pipeline: API -> BullMQ (Redis) -> worker -> Postgres + Elasticsearch,
 * with live progress over Socket.IO. Needs the Docker stack running:  npm run test:e2e
 */
import { INestApplication } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import * as tls from 'node:tls';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FindingsIndexer } from '../src/findings/findings-indexer.service';
import { BatchProgress, ScanProgress } from '../src/scan-jobs/scan-job.types';
import { ScanProcessor } from '../src/scan-jobs/scan.processor';
import { bootTestApp, cleanUpTestQueue, closedPort, startTlsServer, TEST_FINDINGS_INDEX, waitForJob } from './helpers';

describe('Async scan pipeline (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let url: string;
  let tlsServer: tls.Server;
  let tlsPort: number;
  let socket: Socket;
  let events: ScanProgress[];
  let batchEvents: BatchProgress[];

  beforeAll(async () => {
    ({ server: tlsServer, port: tlsPort } = await startTlsServer());
    ({ app, db, url } = await bootTestApp());

    socket = io(`${url}/scans`, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.on('scan.progress', (p: ScanProgress) => events.push(p));
    socket.on('batch.progress', (b: BatchProgress) => batchEvents.push(b));
  });

  afterAll(async () => {
    socket?.disconnect();
    await cleanUpTestQueue(app);
    await app.get(Client).indices.delete({ index: TEST_FINDINGS_INDEX }, { ignore: [404] });
    await app?.close();
    await new Promise((resolve) => tlsServer?.close(resolve));
  });

  beforeEach(async () => {
    events = [];
    batchEvents = [];
    await db.query('TRUNCATE findings, scans, certificates, assets');
  });

  const api = () => request(app.getHttpServer());
  const createAsset = async (body: object) => (await api().post('/api/assets').send(body).expect(201)).body;
  const worker = () => app.get(ScanProcessor).worker;

  /** Events arrive asynchronously (Redis stream -> listener -> socket), so wait for the one we need. */
  async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for Socket.IO events');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('returns 202 right away and pushes every stage of the job over Socket.IO', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });

    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);
    expect(body).toMatchObject({ assetId: asset.id, created: true, jobId: body.scanId });

    await waitForJob(app, body.jobId);
    await eventually(() => events.some((e) => e.jobId === body.jobId && e.stage === 'completed'));

    const stages = events.filter((e) => e.jobId === body.jobId).map((e) => e.stage);
    expect(stages).toEqual(['queued', 'scanning', 'saving', 'indexing', 'completed']);
    expect(events.at(-1)).toMatchObject({
      percent: 100,
      result: { scanId: body.scanId, status: 'success', riskScore: 30, findingsIndexed: 3 },
    });
  });

  it('reports job details through GET /api/scan-jobs/:id', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);

    const job = await waitForJob(app, body.jobId);

    expect(job).toMatchObject({ state: 'completed', attemptsMade: 1, result: { scanId: body.scanId, status: 'success' } });
  });

  it('retries a temporary network error with backoff, then records a failed scan', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: await closedPort() });
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);

    const job = await waitForJob(app, body.jobId);
    await eventually(() => events.some((e) => e.jobId === body.jobId && e.stage === 'completed'));

    expect(job).toMatchObject({ state: 'completed', attemptsMade: 3 });
    const retrying = events.filter((e) => e.jobId === body.jobId && e.stage === 'retrying');
    expect(retrying.map((e) => e.attempt)).toEqual([1, 2]);
    expect(retrying[0].message).toContain('Retrying in 0.1s'); // 100ms, then 200ms (exponential)
    expect(retrying[1].message).toContain('Retrying in 0.2s');
    expect(events.at(-1)?.result).toMatchObject({ status: 'failed', errorCode: 'CONNECTION_REFUSED' });
  });

  it('scans a batch and reports batch progress until 100%', async () => {
    const a = await createAsset({ host: '127.0.0.1', port: tlsPort });
    const b = await createAsset({ host: 'does-not-exist.invalid' }); // permanent DNS error: recorded, no retry

    const { body } = await api().post('/api/scan-jobs').send({ assetIds: [a.id, b.id] }).expect(202);
    expect(body.total).toBe(2);

    await eventually(() => batchEvents.some((e) => e.batchId === body.batchId && e.percent === 100));
    const final = await api().get(`/api/scan-jobs/batches/${body.batchId}`).expect(200);
    expect(final.body).toEqual({ batchId: body.batchId, total: 2, completed: 2, failed: 0, percent: 100 });
  });

  it('rejects a batch with unknown asset ids', async () => {
    const missing = '00000000-0000-4000-a000-000000000000';
    const res = await api().post('/api/scan-jobs').send({ assetIds: [missing] }).expect(400);
    expect(res.body.message).toContain(missing);
  });

  it('deduplicates: a second request while a scan is still queued reuses the same job', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
    await worker().pause(); // keep the first job waiting
    try {
      const first = (await api().post(`/api/assets/${asset.id}/scans`).expect(202)).body;
      const second = (await api().post(`/api/assets/${asset.id}/scans`).expect(202)).body;

      expect(second).toEqual({ ...first, created: false });
    } finally {
      worker().resume();
    }
  });

  it('fails without retrying when the asset is deleted before the worker gets to it', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
    await worker().pause();
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);
    await api().delete(`/api/assets/${asset.id}`).expect(204);
    worker().resume();

    const job = await waitForJob(app, body.jobId);

    expect(job).toMatchObject({ state: 'failed', attemptsMade: 1 }); // UnrecoverableError: no retries
    expect(job.failedReason).toContain('no longer exists');
    await eventually(() => events.some((e) => e.jobId === body.jobId && e.stage === 'failed'));
  });

  it('indexes findings into Elasticsearch with stable ids, so re-indexing never duplicates', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);
    await waitForJob(app, body.jobId);

    const es = app.get(Client);
    const countDocs = async () => {
      await es.indices.refresh({ index: TEST_FINDINGS_INDEX });
      return (await es.count({ index: TEST_FINDINGS_INDEX, query: { term: { scan_id: body.scanId } } })).count;
    };
    expect(await countDocs()).toBe(3);

    await app.get(FindingsIndexer).indexScan(body.scanId); // what a retried job would do
    expect(await countDocs()).toBe(3);

    const hit = await es.search({ index: TEST_FINDINGS_INDEX, query: { match: { description: 'self-signed' } } });
    expect(hit.hits.hits[0]._source).toMatchObject({ host: '127.0.0.1', rule_id: 'CERT_SELF_SIGNED', severity: 'medium' });
  });
});
