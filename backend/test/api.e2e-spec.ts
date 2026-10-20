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
  // scanNow: false so these tests control exactly when scans run (auto-scan has its own tests).
  const createAsset = async (body: object) => (await api().post('/api/assets').send({ scanNow: false, ...body }).expect(201)).body;

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

    it('search accepts a full URL or host:port, like the add form does', async () => {
      await createAsset({ host: 'https://qa.zeuz.ai/' }); // stored as host qa.zeuz.ai, port 443
      await createAsset({ host: 'qa.zeuz.ai', port: 8443 });

      const byUrl = await api().get(`/api/assets?search=${encodeURIComponent('https://qa.zeuz.ai/')}`).expect(200);
      const byHostPort = await api().get('/api/assets?search=qa.zeuz.ai:8443').expect(200);

      expect(byUrl.body.meta.total).toBe(2);
      expect(byHostPort.body.data.map((a: { port: number }) => a.port)).toEqual([8443]);
    });

    it('separates seeded demo hosts (synthetic) from real ones; the API never lets a client set the flag', async () => {
      const real = await createAsset({ host: 'real-host.example' });
      const demo = await createAsset({ host: 'cdn.initech-2410.ca' });
      expect(real.synthetic).toBe(false); // the default for anything added through the API
      await api().post('/api/assets').send({ host: 'x.example', synthetic: true }).expect(400); // unknown field

      // The migration's backfill expression: only the seed's exact host pattern counts as synthetic.
      await db.query(`UPDATE assets SET synthetic = true WHERE id = $1`, [demo.id]);
      const [{ seedLike, realLike }] = await db.query(`
        SELECT 'cdn.initech-2410.ca' ~ $1 AS "seedLike", 'cdn.initech.example.com' ~ $1 AS "realLike"`,
        ['^(www|api|auth|vpn|mail|portal|payments|cdn|admin|sso|gateway|app)\\.(northwind|contoso|fabrikam|initech|umbrella|globex|acme|wayne|stark|hooli)-[0-9]+\\.(com|net|io|org|ca|co\\.uk)$']);
      expect({ seedLike, realLike }).toEqual({ seedLike: true, realLike: false });

      const hosts = async (query: string) =>
        (await api().get(`/api/assets?${query}`).expect(200)).body.data.map((a: { host: string }) => a.host);
      expect(await hosts('synthetic=false')).toEqual(['real-host.example']);
      expect(await hosts('synthetic=true')).toEqual(['cdn.initech-2410.ca']);
      expect(await hosts('sort=host&order=asc')).toEqual(['cdn.initech-2410.ca', 'real-host.example']);
      await api().get('/api/assets?synthetic=maybe').expect(400);
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
      expect(refreshed.lastScanError).toBe('CONNECTION_REFUSED'); // so the UI can say the risk is from an earlier scan

      // A successful scan clears it again
      await api().patch(`/api/assets/${asset.id}`).send({ port: tlsPort }).expect(200);
      await scanAndWait(app, tokens.admin, asset.id);
      expect((await api().get(`/api/assets/${asset.id}`).expect(200)).body.lastScanError).toBeNull();
    });

    it('returns 404 when scanning an unknown asset', async () => {
      await api().post('/api/assets/00000000-0000-4000-a000-000000000000/scans').expect(404);
    });
  });

  describe('dashboard', () => {
    it('summarises the current state from each asset\'s latest scan', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      await createAsset({ host: 'never-scanned.example' });
      await scanAndWait(app, tokens.admin, asset.id);
      await scanAndWait(app, tokens.admin, asset.id); // history must not be double counted

      const { body } = await api().get('/api/dashboard/overview').expect(200);

      expect(body).toMatchObject({
        totalAssets: 2,
        scannedAssets: 1,
        averageRiskScore: 30,
        assetsByRiskLevel: { medium: 1, critical: 0 },
        currentFindingsBySeverity: { medium: 3, critical: 0 }, // 3, not 6
        quantumVulnerableAssets: 1,
        quantumVulnerablePercentage: 100,
        expiredCertificates: 0,
      });
    });

    it('lists certificates in use that expire soon, most urgent first', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      await scanAndWait(app, tokens.admin, asset.id);
      // The test certificate is valid for 10 years; pretend it expires in 5 days.
      await db.query(`UPDATE certificates SET valid_to = now() + interval '5 days 1 hour'`);

      const soon = await api().get('/api/certificates/expiring?days=30').expect(200);
      expect(soon.body.meta.total).toBe(1);
      expect(soon.body.data[0]).toMatchObject({ host: '127.0.0.1', keyAlgorithm: 'RSA', keySize: 2048, daysLeft: 5 });

      const narrow = await api().get('/api/certificates/expiring?days=3').expect(200);
      expect(narrow.body.meta.total).toBe(0);

      // Real vs seeded demo hosts: the row says which, the filter picks one, the overview counts real ones apart.
      expect(soon.body.data[0].synthetic).toBe(false);
      expect((await api().get('/api/certificates/expiring?synthetic=false').expect(200)).body.meta.total).toBe(1);
      expect((await api().get('/api/certificates/expiring?synthetic=true').expect(200)).body.meta.total).toBe(0);
      expect((await api().get('/api/dashboard/overview').expect(200)).body.real).toEqual({ certificatesExpiringIn30Days: 1, expiredCertificates: 0 });
      await db.query(`UPDATE assets SET synthetic = true WHERE id = $1`, [asset.id]);
      expect((await api().get('/api/dashboard/overview').expect(200)).body.real).toEqual({ certificatesExpiringIn30Days: 0, expiredCertificates: 0 });

      await api().get('/api/certificates/expiring?days=1000').expect(400);
    });

    it('findings?latestOnly=true returns only the current findings', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      await scanAndWait(app, tokens.admin, asset.id);
      await scanAndWait(app, tokens.admin, asset.id);

      const all = await api().get('/api/findings').expect(200);
      const current = await api().get('/api/findings?latestOnly=true').expect(200);

      expect(all.body.meta.total).toBe(6);
      expect(current.body.meta.total).toBe(3);
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
