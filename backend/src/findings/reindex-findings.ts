/**
 * Rebuilds the Elasticsearch findings index from PostgreSQL (the source of truth).
 *
 *   npm run findings:reindex
 *
 * Needed once after seeding (the seed writes straight to Postgres), and any time the mapping changes.
 * Zero downtime: writes a NEW versioned index, then atomically points the alias at it.
 */
import 'reflect-metadata';
import { Client } from '@elastic/elasticsearch';
import { loadConfig } from '../config/configuration';
import dataSource from '../database/data-source';
import { FINDINGS_MAPPINGS, FINDINGS_SETTINGS, FindingDocument, versionedIndexName } from './findings-index';

const BATCH = 5_000;

interface Row {
  id: string;
  scan_id: string;
  asset_id: string;
  host: string;
  port: number;
  environment: string;
  rule_id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  evidence: FindingDocument['evidence'];
  risk_score: number | null;
  risk_level: string | null;
  is_current: boolean;
  created_at: Date;
}

/**
 * Keyset pagination ("WHERE id > last ORDER BY id"): every batch is an index range scan, unlike
 * OFFSET, which gets slower the further it goes. Streams 200k+ rows with flat memory use.
 */
async function* findingsFromPostgres(): AsyncGenerator<{ id: string; doc: FindingDocument }> {
  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows: Row[] = await dataSource.query(
      `SELECT f.id, f.scan_id, f.asset_id, a.host, a.port, a.environment, f.rule_id, f.severity, f.category,
              f.title, f.description, f.recommendation, f.evidence, s.risk_score, s.risk_level,
              COALESCE(a.latest_scan_id = f.scan_id, false) AS is_current, f.created_at
       FROM findings f
       JOIN assets a ON a.id = f.asset_id
       JOIN scans s ON s.id = f.scan_id
       WHERE f.id > $1
       ORDER BY f.id
       LIMIT $2`,
      [lastId, BATCH],
    );
    if (rows.length === 0) return;
    for (const { id, ...rest } of rows) yield { id, doc: { finding_id: id, ...rest } };
    lastId = rows[rows.length - 1].id;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const alias = config.elasticsearch.findingsIndex;
  const es = new Client({ node: config.elasticsearch.node, requestTimeout: 120_000 });
  await dataSource.initialize();

  const index = versionedIndexName(alias);
  const started = Date.now();
  console.log(`Reindexing findings from PostgreSQL into ${index} ...`);

  await es.indices.create({
    index,
    mappings: FINDINGS_MAPPINGS,
    settings: { ...FINDINGS_SETTINGS, refresh_interval: '-1' }, // no refreshes during the bulk load
  });

  let count = 0;
  const stats = await es.helpers.bulk<{ id: string; doc: FindingDocument }>({
    datasource: (async function* () {
      for await (const item of findingsFromPostgres()) {
        if (++count % 50_000 === 0) process.stdout.write(`\r  ${count.toLocaleString()} findings`);
        yield item;
      }
    })(),
    onDocument: (item) => [{ index: { _index: index, _id: item.id } }, item.doc],
    flushBytes: 5_000_000,
    concurrency: 3,
    retries: 3,
    onDrop: (failure) => console.error('\n  dropped:', failure.error),
  });

  await es.indices.putSettings({ index, settings: { refresh_interval: '1s' } });
  await es.indices.refresh({ index });

  // Atomic switch. A legacy plain index with the alias's name (from before aliases) is deleted in the
  // same request with remove_index, so there is never a moment without a "cryptoscope-findings".
  const existing = await es.indices.get({ index: alias }, { ignore: [404] });
  const isAlias = await es.indices.existsAlias({ name: alias });
  const oldIndices = isAlias ? Object.keys(await es.indices.getAlias({ name: alias })) : [];
  const legacyIndex = !isAlias && existing && Object.keys(existing).includes(alias);
  await es.indices.updateAliases({
    actions: [
      ...oldIndices.map((old) => ({ remove: { index: old, alias } })),
      ...(legacyIndex ? [{ remove_index: { index: alias } }] : []),
      { add: { index, alias, is_write_index: true } },
    ],
  });
  for (const old of oldIndices) await es.indices.delete({ index: old });

  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n  ${stats.successful.toLocaleString()} indexed, ${stats.failed} failed in ${seconds.toFixed(1)}s.` +
      ` Alias ${alias} -> ${index}${legacyIndex ? ' (replaced legacy index)' : ''}${oldIndices.length ? ` (replaced ${oldIndices.join(', ')})` : ''}`,
  );
  await dataSource.destroy();
  await es.close();
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch(async (err: unknown) => {
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
