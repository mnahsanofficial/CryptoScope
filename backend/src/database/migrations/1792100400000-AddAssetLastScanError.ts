import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * assets.last_scan_error: why the asset's most recent scan failed (null when it succeeded).
 * A failed scan keeps the last known risk, so without this the UI shows "scanned just now, Critical 100"
 * for a host it could not reach at all.
 */
export class AddAssetLastScanError1792100400000 implements MigrationInterface {
  name = 'AddAssetLastScanError1792100400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" ADD "last_scan_error" character varying(32)`);

    // Backfill: assets whose newest scan (DISTINCT ON keeps the first row per asset) failed.
    await queryRunner.query(`
      UPDATE "assets" a SET "last_scan_error" = newest.error_code
      FROM (
        SELECT DISTINCT ON (asset_id) asset_id, status, error_code
        FROM "scans"
        ORDER BY asset_id, scanned_at DESC
      ) newest
      WHERE newest.asset_id = a.id AND newest.status = 'failed'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "last_scan_error"`);
  }
}
