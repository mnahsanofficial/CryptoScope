/**
 * Generates fake TLS handshake logs and bulk-indexes them into Elasticsearch.
 *
 *   npm run logs:generate                         # 500,000 logs over the last 7 days
 *   npm run logs:generate -- --count 50000 --days 2
 *
 * Zero-downtime pattern: write into a NEW versioned index (tls-handshakes-<timestamp>), then atomically
 * move the `tls-handshakes` alias to it and delete the old one. The API always queries the alias,
 * so it never sees a half-loaded index.
 */
import { Client } from '@elastic/elasticsearch';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { loadConfig } from '../../config/configuration';
import { HANDSHAKE_MAPPINGS, HANDSHAKE_SETTINGS, HandshakeLog } from '../handshake-index';
import { DEFAULT_GENERATOR_OPTIONS, generateHandshakes } from './handshake-generator';

loadDotenv({ path: [join(__dirname, '../../../.env'), join(__dirname, '../../../../.env')], quiet: true });

function numberArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

/** Turns the sync generator into the async iterator the bulk helper expects, logging progress. */
async function* withProgress(docs: Iterable<HandshakeLog>, total: number): AsyncGenerator<HandshakeLog> {
  let n = 0;
  for (const doc of docs) {
    yield doc;
    if (++n % 50_000 === 0) process.stdout.write(`\r  generated ${n.toLocaleString()} / ${total.toLocaleString()}`);
  }
}

async function currentIndicesBehind(client: Client, alias: string): Promise<string[]> {
  const exists = await client.indices.existsAlias({ name: alias });
  if (!exists) return [];
  return Object.keys(await client.indices.getAlias({ name: alias }));
}

/**
 * Best effort: creates a Kibana data view so the logs can be explored in Discover right away, and makes
 * Discover (with this data view) the page Kibana opens on, instead of the generic "Welcome home".
 */
async function ensureKibanaDataView(alias: string): Promise<void> {
  const kibana = process.env.KIBANA_URL ?? `http://localhost:${process.env.KIBANA_PORT ?? 5601}`;
  try {
    const res = await fetch(`${kibana}/api/data_views/data_view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'kbn-xsrf': 'true' },
      body: JSON.stringify({
        data_view: { id: alias, title: alias, name: 'TLS handshakes', timeFieldName: '@timestamp' },
        override: true,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.log(`  Kibana data view skipped (HTTP ${res.status})`);
      return;
    }
    await fetch(`${kibana}/api/kibana/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'kbn-xsrf': 'true' },
      // The logs cover the last 7 days; Kibana's default of 15 minutes would look empty.
      body: JSON.stringify({
        changes: {
          defaultRoute: '/app/discover',
          defaultIndex: alias,
          'timepicker:timeDefaults': JSON.stringify({ from: 'now-7d', to: 'now' }),
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    console.log(`  Kibana data view "${alias}" ready at ${kibana} (opens on Discover)`);
  } catch {
    console.log('  Kibana not reachable, data view skipped');
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const alias = config.elasticsearch.handshakeIndex;
  const options = {
    ...DEFAULT_GENERATOR_OPTIONS,
    count: numberArg('count', DEFAULT_GENERATOR_OPTIONS.count),
    days: numberArg('days', DEFAULT_GENERATOR_OPTIONS.days),
    hostCount: numberArg('hosts', DEFAULT_GENERATOR_OPTIONS.hostCount),
    end: new Date(),
  };

  const client = new Client({ node: config.elasticsearch.node, requestTimeout: 120_000 });
  const index = `${alias}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const started = Date.now();
  console.log(`Indexing ${options.count.toLocaleString()} handshakes (${options.days} days, ${options.hostCount} hosts) into ${index}`);

  // A concrete index with the alias's name would block creating the alias.
  if ((await client.indices.exists({ index: alias })) && !(await client.indices.existsAlias({ name: alias }))) {
    throw new Error(`"${alias}" exists as an index, not an alias. Delete it first: DELETE /${alias}`);
  }

  await client.indices.create({
    index,
    mappings: HANDSHAKE_MAPPINGS,
    // No refreshes during the bulk load: refreshing makes new segments searchable and is wasted work here.
    settings: { ...HANDSHAKE_SETTINGS, refresh_interval: '-1' },
  });

  let dropped = 0;
  const stats = await client.helpers.bulk<HandshakeLog>({
    datasource: withProgress(generateHandshakes(options), options.count),
    onDocument: () => ({ index: { _index: index } }),
    flushBytes: 5_000_000, // ~5 MB per _bulk request
    concurrency: 3, // parallel _bulk requests
    retries: 3, // retried automatically on 429 (Too Many Requests)
    onDrop: (failure) => {
      dropped++;
      if (dropped <= 3) console.error('\n  dropped document:', failure.error);
    },
  });
  console.log(`\n  bulk: ${stats.successful.toLocaleString()} indexed, ${stats.failed} failed in ${(stats.time / 1000).toFixed(1)}s`);

  // Back to normal and optimise for reading: these logs won't change any more.
  await client.indices.putSettings({ index, settings: { refresh_interval: '1s' } });
  await client.indices.refresh({ index });
  await client.indices.forcemerge({ index, max_num_segments: 1 });

  // Atomic alias switch: readers move from the old index to the new one in one step.
  const oldIndices = await currentIndicesBehind(client, alias);
  await client.indices.updateAliases({
    actions: [
      ...oldIndices.map((old) => ({ remove: { index: old, alias } })),
      { add: { index, alias, is_write_index: true } },
    ],
  });
  for (const old of oldIndices) await client.indices.delete({ index: old });

  const { count } = await client.count({ index: alias });
  const seconds = (Date.now() - started) / 1000;
  console.log(`  alias ${alias} -> ${index} (${count.toLocaleString()} docs). Replaced: ${oldIndices.join(', ') || 'none'}`);
  console.log(`Done in ${seconds.toFixed(1)}s (${Math.round(count / seconds).toLocaleString()} docs/s)`);

  await ensureKibanaDataView(alias);
  await client.close();
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
