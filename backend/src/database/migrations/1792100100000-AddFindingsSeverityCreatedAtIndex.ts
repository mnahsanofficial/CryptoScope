import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Query-optimisation fix (see docs/query-optimization.md).
 *
 * The findings list filters by severity and sorts by newest first:
 *   WHERE severity = 'critical' ORDER BY created_at DESC, id DESC LIMIT 20
 * Without this index Postgres reads every finding, filters, then sorts. With it, Postgres jumps to the
 * 'critical' part of the index and reads it backwards (newest first), stopping after 20 rows.
 * Column order matters: the equality column (severity) first, then the ORDER BY columns in order.
 * `id` is the tie-breaker the API sorts by, so including it means no extra sort step at all.
 */
export class AddFindingsSeverityCreatedAtIndex1792100100000 implements MigrationInterface {
  name = 'AddFindingsSeverityCreatedAtIndex1792100100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "idx_findings_severity_created_at" ON "findings" ("severity", "created_at", "id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_findings_severity_created_at"`);
  }
}
