/**
 * End-to-end tests for the handshake analytics: real HTTP endpoints + real Elasticsearch.
 * Indexes 8 hand-crafted handshakes into a temporary index, so every aggregation result can be checked
 * against numbers worked out by hand. Needs Elasticsearch running:  npm run test:e2e
 */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Client } from '@elastic/elasticsearch';
import { join } from 'node:path';
import request from 'supertest';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { HANDSHAKE_INDEX } from '../src/analytics/analytics.service';
import { HANDSHAKE_MAPPINGS, HANDSHAKE_SETTINGS, HandshakeLog } from '../src/analytics/handshake-index';
import { configureApp } from '../src/app.setup';
import { loadConfig } from '../src/config/configuration';
import { ElasticsearchModule } from '../src/infra/elasticsearch.module';

const TEST_INDEX = `tls-handshakes-e2e-${Date.now()}`;
const RANGE = 'from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z';

const MODERN_UA = 'Mozilla/5.0 Chrome/131.0';
const doc = (time: string, fields: Partial<HandshakeLog>): HandshakeLog => ({
  '@timestamp': `2026-06-01T${time}:00.000Z`,
  host: 'a.com',
  client_ip: '10.0.0.1',
  tls_version: 'TLSv1.2',
  cipher: 'ECDHE-RSA-AES128-GCM-SHA256',
  key_algorithm: 'RSA',
  key_size: 2048,
  kex_group: 'X25519',
  quantum_vulnerable: true,
  user_agent: MODERN_UA,
  handshake_ms: 20,
  ...fields,
});

// Comments: why each handshake is (not) weak / (not) quantum-vulnerable.
const HANDSHAKES: HandshakeLog[] = [
  doc('10:05', { tls_version: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256', key_algorithm: 'EC', key_size: 256, kex_group: 'X25519MLKEM768', quantum_vulnerable: false }), // clean, PQ
  doc('10:20', { tls_version: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256', key_algorithm: 'EC', key_size: 256, user_agent: 'curl/8.9.1' }), // clean, classical kex
  doc('10:40', { host: 'old.com', tls_version: 'TLSv1', cipher: 'DES-CBC3-SHA', key_size: 1024, user_agent: 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1)' }), // weak x3
  doc('11:10', { host: 'old.com', key_size: 1024, kex_group: 'secp256r1' }), // weak RSA
  doc('11:30', { host: 'older.com', key_size: 512, kex_group: 'secp256r1', user_agent: 'Java/1.7.0_80' }), // weak RSA
  doc('12:15', { host: 'b.com', cipher: 'RC4-SHA', user_agent: 'python-requests/2.32.3' }), // weak cipher
  doc('13:00', { host: 'pq.com', tls_version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', key_algorithm: 'ML-DSA-65', key_size: null, kex_group: 'X25519MLKEM768', quantum_vulnerable: false }), // clean, PQ
  doc('13:30', { host: 'b.com', tls_version: 'TLSv1.1', cipher: 'ECDHE-RSA-AES256-SHA', user_agent: 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)' }), // legacy TLS
  doc('15:00', { host: 'outside.com', tls_version: 'TLSv1' }), // outside the queried range: must never be counted
];

describe('Handshake analytics (e2e)', () => {
  let app: INestApplication;
  let es: Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: [join(__dirname, '../../.env')], load: [() => loadConfig()] }),
        ElasticsearchModule,
        AnalyticsModule,
      ],
    })
      .overrideProvider(HANDSHAKE_INDEX)
      .useValue(TEST_INDEX)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    es = app.get(Client);
    await es.indices.create({ index: TEST_INDEX, mappings: HANDSHAKE_MAPPINGS, settings: HANDSHAKE_SETTINGS });
    await es.bulk({
      refresh: 'wait_for', // make the docs searchable before the tests run
      operations: HANDSHAKES.flatMap((d) => [{ index: { _index: TEST_INDEX } }, d]),
    });
  });

  afterAll(async () => {
    await es?.indices.delete({ index: TEST_INDEX }, { ignore: [404] });
    await app?.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(`/api/analytics/handshakes/${path}`);

  it('counts handshakes by key algorithm (terms aggregation)', async () => {
    const { body } = await get(`key-algorithms?${RANGE}`).expect(200);

    expect(body.total).toBe(8);
    expect(body.algorithms).toEqual([
      { keyAlgorithm: 'RSA', count: 5, percentage: 62.5, keySizes: expect.arrayContaining([{ keySize: 1024, count: 2 }, { keySize: 2048, count: 2 }, { keySize: 512, count: 1 }]) },
      { keyAlgorithm: 'EC', count: 2, percentage: 25, keySizes: [{ keySize: 256, count: 2 }] },
      { keyAlgorithm: 'ML-DSA-65', count: 1, percentage: 12.5, keySizes: [] },
    ]);
  });

  it('counts weak handshakes per hour (date_histogram + filter), including the reasons', async () => {
    const { body } = await get(`weak-per-interval?${RANGE}&interval=1h`).expect(200);

    expect(body).toMatchObject({ total: 8, weak: 5, weakPercentage: 62.5 });
    expect(body.reasons).toEqual({ legacy_protocol: 2, weak_rsa_key: 3, weak_cipher: 2 });
    expect(body.buckets.map((b: { timestamp: string; total: number; weak: number }) => [b.timestamp.slice(11, 16), b.total, b.weak])).toEqual([
      ['10:00', 3, 1],
      ['11:00', 2, 2],
      ['12:00', 1, 1],
      ['13:00', 2, 1],
    ]);
  });

  it('returns empty buckets as zero instead of skipping them', async () => {
    const { body } = await get('weak-per-interval?from=2026-06-01T08:00:00Z&to=2026-06-01T11:00:00Z').expect(200);
    expect(body.buckets.map((b: { total: number }) => b.total)).toEqual([0, 0, 3]);
  });

  it('lists the top hosts still using RSA keys under 2048 bits', async () => {
    const { body } = await get(`top-weak-rsa-hosts?${RANGE}&limit=10`).expect(200);

    expect(body).toMatchObject({ weakRsaHandshakes: 3, affectedHosts: 2 });
    expect(body.hosts.map((h: { host: string; handshakes: number; keySize: number }) => [h.host, h.handshakes, h.keySize])).toEqual([
      ['old.com', 2, 1024],
      ['older.com', 1, 512],
    ]);
  });

  it('computes the percentage of quantum-vulnerable traffic', async () => {
    const { body } = await get(`quantum-vulnerable?${RANGE}`).expect(200);

    expect(body).toMatchObject({ total: 8, quantumVulnerable: 6, quantumSafe: 2, percentage: 75 });
    expect(body.byKeyExchangeGroup).toEqual([
      { group: 'X25519', count: 4, percentage: 50 },
      { group: 'X25519MLKEM768', count: 2, percentage: 25 },
      { group: 'secp256r1', count: 2, percentage: 25 },
    ]);
  });

  describe('search: query context + filter context', () => {
    it('full-text "msie" matches both Internet Explorer handshakes, with a relevance score', async () => {
      const { body } = await get(`search?${RANGE}&q=msie`).expect(200);

      expect(body.meta.total).toBe(2);
      expect(body.data.every((h: { user_agent: string; score: number }) => h.user_agent.includes('MSIE') && h.score > 0)).toBe(true);
    });

    it('a filter narrows the result without being scored', async () => {
      const { body } = await get(`search?${RANGE}&q=msie&tlsVersion=TLSv1`).expect(200);
      expect(body.data.map((h: { host: string }) => h.host)).toEqual(['old.com']);
    });

    it('without free text, results are newest first', async () => {
      const { body } = await get(`search?${RANGE}&host=b.com`).expect(200);
      expect(body.data.map((h: { '@timestamp': string }) => h['@timestamp'].slice(11, 16))).toEqual(['13:30', '12:15']);
      expect(body.data[0].score).toBeNull();
    });
  });

  it('rejects invalid parameters', async () => {
    await get('weak-per-interval?interval=7m').expect(400);
    await get('key-algorithms?from=2026-06-02T00:00:00Z&to=2026-06-01T00:00:00Z').expect(400);
    await get('top-weak-rsa-hosts?limit=500').expect(400);
  });
});

describe('Handshake analytics without an index (e2e)', () => {
  it('answers 404 with a hint instead of a 500', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: [join(__dirname, '../../.env')], load: [() => loadConfig()] }),
        ElasticsearchModule,
        AnalyticsModule,
      ],
    })
      .overrideProvider(HANDSHAKE_INDEX)
      .useValue('index-that-does-not-exist')
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    const { body } = await request(app.getHttpServer()).get('/api/analytics/handshakes/key-algorithms').expect(404);
    expect(body.message).toContain('npm run logs:generate');

    await app.close();
  });
});
