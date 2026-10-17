/**
 * End-to-end tests for the async scan pipeline: API -> BullMQ (Redis) -> worker -> Postgres + Elasticsearch,
 * with live progress over Socket.IO. Needs the Docker stack running:  npm run test:e2e
 */
import { INestApplication } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import * as tls from 'node:tls';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { FindingsIndexer } from '../src/findings/findings-indexer.service';
import { BatchProgress, ScanProgress } from '../src/scan-jobs/scan-job.types';
import { ScanProcessor } from '../src/scan-jobs/scan.processor';
import {
  bootTestApp,
  cleanUpTestQueue,
  client,
  closedPort,
  deleteIndexOrAlias,
  startTlsServer,
  TEST_FINDINGS_INDEX,
  TestTokens,
  waitForJob,
} from './helpers';

describe('Async scan pipeline (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let url: string;
  let tlsServer: tls.Server;
  let tlsPort: number;
  let socket: Socket;
  let events: ScanProgress[];
  let batchEvents: BatchProgress[];
  let tokens: TestTokens;

  beforeAll(async () => {
    ({ server: tlsServer, port: tlsPort } = await startTlsServer());
    ({ app, db, url, tokens } = await bootTestApp());
    // Start from a fresh findings index with the current mapping (a previous run may have left one).
    await deleteIndexOrAlias(app.get(Client), TEST_FINDINGS_INDEX);
    await app.get(FindingsIndexer).ensureIndex();

    socket = io(`${url}/scans`, { transports: ['websocket'], auth: { token: tokens.viewer } }); // viewers may watch
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
    await deleteIndexOrAlias(app.get(Client), TEST_FINDINGS_INDEX);
    await app?.close();
    await new Promise((resolve) => tlsServer?.close(resolve));
  });

  beforeEach(async () => {
    events = [];
    batchEvents = [];
    await db.query('TRUNCATE findings, scans, certificates, assets');
  });

  const api = () => client(app, tokens.admin);
  // scanNow: false so these tests control exactly when scans run (auto-scan has its own tests).
  const createAsset = async (body: object) => (await api().post('/api/assets').send({ scanNow: false, ...body }).expect(201)).body;
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

    await waitForJob(app, tokens.admin, body.jobId);
    await eventually(() => events.some((e) => e.jobId === body.jobId && e.stage === 'completed'));

    const stages = events.filter((e) => e.jobId === body.jobId).map((e) => e.stage);
    expect(stages).toEqual(['queued', 'scanning', 'saving', 'indexing', 'completed']);
    expect(events.at(-1)).toMatchObject({
      percent: 100,
      result: { scanId: body.scanId, status: 'success', riskScore: 30, findingsIndexed: 3 },
    });
  });

  it('adding an asset queues its first scan automatically', async () => {
    const { body: asset } = await api().post('/api/assets').send({ host: '127.0.0.1', port: tlsPort }).expect(201);

    expect(asset.scanJob).toMatchObject({ assetId: asset.id, created: true });
    const job = await waitForJob(app, tokens.admin, asset.scanJob.jobId);
    expect(job.state).toBe('completed');

    const { body: scanned } = await api().get(`/api/assets/${asset.id}`).expect(200);
    expect(scanned).toMatchObject({ latestRiskScore: 30, latestRiskLevel: 'medium' });
    await eventually(() => events.some((e) => e.jobId === asset.scanJob.jobId && e.stage === 'completed'));
  });

  it('scanNow: false only records the asset', async () => {
    const { body: asset } = await api().post('/api/assets').send({ host: '127.0.0.1', port: tlsPort, scanNow: false }).expect(201);

    expect(asset.scanJob).toBeNull();
    const { body: counts } = await api().get('/api/scan-jobs').expect(200);
    expect(counts.waiting + counts.active).toBe(0);
  });

  it('reports job details through GET /api/scan-jobs/:id', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);

    const job = await waitForJob(app, tokens.admin, body.jobId);

    expect(job).toMatchObject({ state: 'completed', attemptsMade: 1, result: { scanId: body.scanId, status: 'success' } });
  });

  it('retries a temporary network error with backoff, then records a failed scan', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: await closedPort() });
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);

    const job = await waitForJob(app, tokens.admin, body.jobId);
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

    const job = await waitForJob(app, tokens.admin, body.jobId);

    expect(job).toMatchObject({ state: 'failed', attemptsMade: 1 }); // UnrecoverableError: no retries
    expect(job.failedReason).toContain('no longer exists');
    await eventually(() => events.some((e) => e.jobId === body.jobId && e.stage === 'failed'));
  });

  it('indexes findings into Elasticsearch with stable ids, so re-indexing never duplicates', async () => {
    const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
    const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);
    await waitForJob(app, tokens.admin, body.jobId);

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

  describe('findings search (Elasticsearch)', () => {
    const search = (query: string) => api().get(`/api/findings/search?pageSize=100&${query}`).expect(200);
    // Other tests also scan 127.0.0.1, so look only at this test's asset.
    type Hit = { assetId: string; ruleId: string; isCurrent: boolean; highlight: Record<string, string | undefined> };
    const forAsset = (body: { data: Hit[] }, assetId: string) => body.data.filter((d) => d.assetId === assetId);

    it('marks older findings as history when a newer scan of the same asset arrives', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      for (let i = 0; i < 2; i++) {
        const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);
        await waitForJob(app, tokens.admin, body.jobId);
      }

      const current = await search('q=self-signed');
      const all = await search('q=self-signed&currentOnly=false');

      expect(forAsset(current.body, asset.id)).toHaveLength(1); // only the latest scan's finding
      expect(forAsset(all.body, asset.id)).toHaveLength(2); // both scans
      expect(forAsset(current.body, asset.id)[0]).toMatchObject({ ruleId: 'CERT_SELF_SIGNED', isCurrent: true });
    });

    it('is typo-tolerant, matches across fields, highlights, and counts severities before the severity filter', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      const { body } = await api().post(`/api/assets/${asset.id}/scans`).expect(202);
      await waitForJob(app, tokens.admin, body.jobId);

      // "slef-signd" has two typos; "127" matches the host, "quantum" the text: words may match different fields.
      const typo = await search('q=slef-signd');
      const crossField = await search(`q=${encodeURIComponent('127 quantum')}`);
      const filtered = await search('q=127&severity=critical');

      const typoHit = forAsset(typo.body, asset.id)[0];
      expect(typoHit.ruleId).toBe('CERT_SELF_SIGNED');
      expect(typoHit.highlight.description).toContain('\u0001'); // highlight markers, not HTML
      expect(forAsset(crossField.body, asset.id).map((d) => d.ruleId)).toEqual(
        expect.arrayContaining(['QUANTUM_VULNERABLE_KEY', 'NO_PQ_KEY_EXCHANGE']),
      );
      expect(filtered.body.meta.total).toBe(0); // the local test server has no critical findings
      // ...but the severity counts ignore the severity filter (post_filter), so "medium" still shows up.
      expect(filtered.body.facets.severity.medium).toBeGreaterThanOrEqual(3);
    });

    it('validates input', async () => {
      await api().get('/api/findings/search').expect(400); // q is required
      await api().get('/api/findings/search?q=x&severity=urgent').expect(400);
      await api().get('/api/findings/search?q=x&page=200&pageSize=100').expect(400); // beyond max_result_window
    });
  });
});
