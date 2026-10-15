/**
 * Shows the effect of idx_findings_severity_created_at on the findings list query.
 *
 *   npm run seed            # needs data first
 *   npm run db:explain-demo
 *
 * "Before" is measured inside a transaction that drops the index and is then ROLLED BACK,
 * so the database is left unchanged. (Postgres DDL is transactional. Never do this on a
 * production database: DROP INDEX takes an exclusive lock on the table.)
 */
// Decorators (entities, DTOs) need this; Nest loads it automatically, standalone scripts must do it themselves.
import 'reflect-metadata';
import { QueryRunner } from 'typeorm';
import { ListFindingsQueryDto } from '../../findings/dto/list-findings.query';
import { Finding } from '../../findings/finding.entity';
import { FindingsService } from '../../findings/findings.service';
import dataSource from '../data-source';

const INDEX = 'idx_findings_severity_created_at';
const RUNS = 5;

interface Measurement {
  plan: string;
  bestMs: number;
}

/** Runs EXPLAIN ANALYZE several times and keeps the fastest run (the first one may hit a cold cache). */
async function measure(runner: QueryRunner, sql: string, params: unknown[]): Promise<Measurement> {
  let best: Measurement | null = null;
  for (let i = 0; i < RUNS; i++) {
    const rows: Array<{ 'QUERY PLAN': string }> = await runner.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1]);
    if (!best || ms < best.bestMs) best = { plan, bestMs: ms };
  }
  return best!;
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const findings = new FindingsService(dataSource.getRepository(Finding));

  // Exactly what GET /api/findings?severity=critical (page 1, newest first) runs
  const query = Object.assign(new ListFindingsQueryDto(), { severity: ['critical'], page: 1, pageSize: 20 });
  const [sql, params] = findings.buildListQuery(query).getQueryAndParameters();

  const [{ count }] = await dataSource.query('SELECT COUNT(*)::int AS count FROM findings');
  console.log(`findings table: ${count} rows\n\nSQL:\n${sql}\nparams: ${JSON.stringify(params)}\n`);

  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(`DROP INDEX ${INDEX}`);
    const before = await measure(runner, sql, params);
    await runner.rollbackTransaction(); // the index is back

    const after = await measure(runner, sql, params);

    console.log(`=== BEFORE (no ${INDEX}) ===\n${before.plan}\n`);
    console.log(`=== AFTER (with ${INDEX}) ===\n${after.plan}\n`);
    console.log(
      `Best of ${RUNS}: ${before.bestMs.toFixed(3)} ms -> ${after.bestMs.toFixed(3)} ms ` +
        `(${(before.bestMs / after.bestMs).toFixed(0)}x faster)`,
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
