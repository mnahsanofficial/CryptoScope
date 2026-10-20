/**
 * Adds the real targets in real-targets.ts to the inventory and scans them, through the REST API:
 *
 *   npm run seed:real
 *
 * It uses the same path as the "Add an asset" form (POST /api/assets with scanNow), so every host goes through
 * the queue, the worker, the risk rules and Elasticsearch, and the scans show up live in the dashboard.
 * Safe to run again: hosts already in the inventory are skipped (409). Needs the stack running and
 * ADMIN_EMAIL / ADMIN_PASSWORD in .env.
 */
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { parseTarget } from '../../scanner/scan-target';
import { REAL_TARGETS } from './real-targets';

loadDotenv({ path: [join(__dirname, '../../../.env'), join(__dirname, '../../../../.env')], quiet: true });

const API = process.env.API_URL ?? `http://localhost:${process.env.BACKEND_PORT ?? 3001}/api`;
// The API allows 100 requests a minute per client: stay under it rather than collect 429s.
const DELAY_MS = 700;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(): Promise<string> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** POST one asset; on 429 wait as long as the server asks (Retry-After) and try again. */
async function addAsset(token: string, body: object): Promise<number> {
  for (;;) {
    const res = await fetch(`${API}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.status !== 429) return res.status;
    await sleep((Number(res.headers.get('retry-after')) || 10) * 1000);
  }
}

async function main(): Promise<void> {
  const token = await login();
  const counts = { added: 0, existing: 0, failed: 0 };
  console.log(`Adding ${REAL_TARGETS.length} real hosts through ${API} ...`);

  for (const [i, { target, label }] of REAL_TARGETS.entries()) {
    const { host, port } = parseTarget(target);
    const status = await addAsset(token, { host, port, label, environment: 'production', scanNow: true });
    if (status === 201) counts.added++;
    else if (status === 409) counts.existing++;
    else {
      counts.failed++;
      console.error(`\n  ${target}: HTTP ${status}`);
    }
    process.stdout.write(`\r  ${i + 1}/${REAL_TARGETS.length}`);
    await sleep(DELAY_MS);
  }

  console.log(`\n  ${counts.added} added and queued for scanning, ${counts.existing} already there, ${counts.failed} failed.`);
  console.log('  Scans run in the background (5 at a time); watch them on the dashboard.');
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
