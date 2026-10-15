/**
 * End-to-end tests: the real Nest app + real PostgreSQL (with migrations) + Redis/BullMQ worker
 * + a real local TLS server. Needs the Docker stack running:  npm run test:e2e
 *
 * Uses a separate database, queue prefix and index (see helpers.ts), so it never touches dev data.
 */
import { INestApplication } from '@nestjs/common';
import * as tls from 'node:tls';
import { DataSource } from 'typeorm';
import { bootTestApp, cleanUpTestQueue, client, closedPort, scanAndWait, startTlsServer, TestTokens } from './helpers';

describe('CryptoScope API (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let tlsServer: tls.Server;
  let tlsPort: number;
  let tokens: TestTokens;

  beforeAll(async () => {
    ({ server: tlsServer, port: tlsPort } = await startTlsServer());
    ({ app, db, tokens } = await bootTestApp()); // runs migrations (migrationsRun: true) and starts the worker
  });

  afterAll(async () => {
    if (app) await cleanUpTestQueue(app);
    await app?.close();
    await new Promise((resolve) => tlsServer?.close(resolve));
  });

  beforeEach(async () => {
    await db.query('TRUNCATE findings, scans, certificates, assets');
  });

  const api = () => client(app, tokens.admin);
  const createAsset = async (body: object) => (await api().post('/api/assets').send(body).expect(201)).body;

  describe('assets CRUD', () => {
    it('creates, reads, updates and deletes an asset', async () => {
      const created = await createAsset({ host: 'Example.COM', label: 'Main site' });
      expect(created).toMatchObject({ host: 'example.com', port: 443, environment: 'production', latestRiskScore: null });

      await api().get(`/api/assets/${created.id}`).expect(200);

      const updated = await api().patch(`/api/assets/${created.id}`).send({ environment: 'staging' }).expect(200);
      expect(updated.body).toMatchObject({ environment: 'staging', label: 'Main site' });

      await api().delete(`/api/assets/${created.id}`).expect(204);
      await api().get(`/api/assets/${created.id}`).expect(404);
    });

    it('rejects duplicates (409), bad hosts (400), unknown fields (400) and bad ids (400)', async () => {
      await createAsset({ host: 'example.com' });

      await api().post('/api/assets').send({ host: 'EXAMPLE.com' }).expect(409);
      await api().post('/api/assets').send({ host: 'not a host' }).expect(400);
      await api().post('/api/assets').send({ host: 'ok.com', isAdmin: true }).expect(400);
      await api().get('/api/assets/123').expect(400);
    });

    it('lists with search, sorting and pagination', async () => {
      for (const host of ['a.bank.com', 'b.bank.com', 'c.bank.com', 'shop.com']) await createAsset({ host });

      const res = await api().get('/api/assets?search=bank&sort=host&order=asc&page=2&pageSize=2').expect(200);

      expect(res.body.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
      expect(res.body.data.map((a: { host: string }) => a.host)).toEqual(['c.bank.com']);
    });

    it('treats LIKE wildcards in search literally', async () => {
      await createAsset({ host: 'shop.com' });
      const res = await api().get('/api/assets?search=%25').expect(200); // "%" must not match everything
      expect(res.body.meta.total).toBe(0);
    });
  });

  describe('scans', () => {
    it('scans an asset and stores scan, certificate, findings and the latest risk', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });

      const { job, scan } = await scanAndWait(app, tokens.admin, asset.id);

      expect(job.state).toBe('completed');
      expect(scan).toMatchObject({ status: 'success', protocol: 'TLSv1.3', riskScore: 30, riskLevel: 'medium' });
      expect(scan.certificate).toMatchObject({ keyAlgorithm: 'RSA', keySize: 2048, selfSigned: true });
      expect(scan.findings.map((f: { ruleId: string }) => f.ruleId).sort()).toEqual(
        ['CERT_SELF_SIGNED', 'NO_PQ_KEY_EXCHANGE', 'QUANTUM_VULNERABLE_KEY'].sort(),
      );

      const refreshed = (await api().get(`/api/assets/${asset.id}`).expect(200)).body;
      expect(refreshed).toMatchObject({ latestRiskScore: 30, latestRiskLevel: 'medium' });
    });

    it('stores a certificate once even when it is seen in many scans', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });

      await scanAndWait(app, tokens.admin, asset.id);
      await scanAndWait(app, tokens.admin, asset.id);

      const [{ scans, certificates }] = await db.query(
        'SELECT (SELECT COUNT(*)::int FROM scans) AS scans, (SELECT COUNT(*)::int FROM certificates) AS certificates',
      );
      expect({ scans, certificates }).toEqual({ scans: 2, certificates: 1 });

      const history = (await api().get(`/api/assets/${asset.id}/scans`).expect(200)).body;
      expect(history.meta.total).toBe(2);
    });

    it('records a failed scan without changing the last known risk', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      await scanAndWait(app, tokens.admin, asset.id);

      // Point the asset at a port where nothing listens, so the next scan is refused
      await api().patch(`/api/assets/${asset.id}`).send({ port: await closedPort() }).expect(200);
      const { job, scan: failed } = await scanAndWait(app, tokens.admin, asset.id);

      // "Refused" may be temporary, so the worker retried before saving it as a failed scan
      expect(job).toMatchObject({ state: 'completed', attemptsMade: 3 });
      expect(failed).toMatchObject({ status: 'failed', errorCode: 'CONNECTION_REFUSED', riskScore: null, findings: [] });
      const refreshed = (await api().get(`/api/assets/${asset.id}`).expect(200)).body;
      expect(refreshed.latestRiskScore).toBe(30);
    });

    it('returns 404 when scanning an unknown asset', async () => {
      await api().post('/api/assets/00000000-0000-4000-a000-000000000000/scans').expect(404);
    });
  });

  describe('findings', () => {
    let assetId: string;

    beforeEach(async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      assetId = asset.id;
      await scanAndWait(app, tokens.admin, assetId);
    });

    it('filters by category and includes the asset host', async () => {
      const res = await api().get('/api/findings?category=quantum').expect(200);

      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.every((f: { category: string }) => f.category === 'quantum')).toBe(true);
      expect(res.body.data[0].asset).toMatchObject({ id: assetId, host: '127.0.0.1' });
    });

    it('filters by severity, rule and asset', async () => {
      const bySeverity = await api().get('/api/findings?severity=critical,high').expect(200);
      expect(bySeverity.body.meta.total).toBe(0);

      const byRule = await api().get(`/api/findings?ruleId=CERT_SELF_SIGNED&assetId=${assetId}`).expect(200);
      expect(byRule.body.meta.total).toBe(1);
    });

    it('rejects invalid filters with 400', async () => {
      await api().get('/api/findings?severity=urgent').expect(400);
      await api().get('/api/findings?pageSize=1000').expect(400);
      await api().get('/api/findings?sort=evidence').expect(400);
    });

    it('cascades: deleting the asset deletes its scans and findings', async () => {
      await api().delete(`/api/assets/${assetId}`).expect(204);

      const res = await api().get('/api/findings').expect(200);
      expect(res.body.meta.total).toBe(0);
    });
  });
});
