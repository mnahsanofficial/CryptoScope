/**
 * End-to-end tests: the real Nest app + real PostgreSQL (with migrations) + a real local TLS server.
 * Needs the Docker stack running (Postgres, Redis, Elasticsearch):  npm run test:e2e
 *
 * Uses a separate database (cryptoscope_test) so it never touches seeded or real data.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadDotenv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { AddressInfo, createServer } from 'node:net';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { Client } from 'pg';
import request from 'supertest';
import { DataSource } from 'typeorm';

const TEST_DB = 'cryptoscope_test';

loadDotenv({ path: [join(__dirname, '../.env'), join(__dirname, '../../.env')], quiet: true });

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

/** Local TLS server with the self-signed RSA-2048 test certificate and classical-only key exchange. */
async function startTlsServer(): Promise<{ port: number; server: tls.Server }> {
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
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('CryptoScope API (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let tlsServer: tls.Server;
  let tlsPort: number;

  beforeAll(async () => {
    await ensureTestDatabase();
    process.env.POSTGRES_DB = TEST_DB; // must be set before AppModule reads its config
    process.env.SCAN_TIMEOUT_MS = '2000';

    ({ server: tlsServer, port: tlsPort } = await startTlsServer());

    // Imported after the env is set, because the config is loaded when the module is evaluated.
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init(); // runs migrations (migrationsRun: true)
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => tlsServer?.close(resolve));
  });

  beforeEach(async () => {
    await db.query('TRUNCATE findings, scans, certificates, assets');
  });

  const api = () => request(app.getHttpServer());
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

      const scan = (await api().post(`/api/assets/${asset.id}/scans`).expect(201)).body;

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

      await api().post(`/api/assets/${asset.id}/scans`).expect(201);
      await api().post(`/api/assets/${asset.id}/scans`).expect(201);

      const [{ scans, certificates }] = await db.query(
        'SELECT (SELECT COUNT(*)::int FROM scans) AS scans, (SELECT COUNT(*)::int FROM certificates) AS certificates',
      );
      expect({ scans, certificates }).toEqual({ scans: 2, certificates: 1 });

      const history = (await api().get(`/api/assets/${asset.id}/scans`).expect(200)).body;
      expect(history.meta.total).toBe(2);
    });

    it('records a failed scan without changing the last known risk', async () => {
      const asset = await createAsset({ host: '127.0.0.1', port: tlsPort });
      await api().post(`/api/assets/${asset.id}/scans`).expect(201);

      // Point the asset at a port where nothing listens, so the next scan is refused
      await api().patch(`/api/assets/${asset.id}`).send({ port: await closedPort() }).expect(200);
      const failed = (await api().post(`/api/assets/${asset.id}/scans`).expect(201)).body;

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
      await api().post(`/api/assets/${assetId}/scans`).expect(201);
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
