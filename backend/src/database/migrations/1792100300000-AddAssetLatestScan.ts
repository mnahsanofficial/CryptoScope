import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * assets.latest_scan_id points at each asset's newest SUCCESSFUL scan, so the dashboard can show
 * "current" findings (from the latest scan only) instead of every historical finding.
 */
export class AddAssetLatestScan1792100300000 implements MigrationInterface {
  name = 'AddAssetLatestScan1792100300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" ADD "latest_scan_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "assets" ADD CONSTRAINT "fk_assets_latest_scan_id"
      FOREIGN KEY ("latest_scan_id") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`CREATE INDEX "idx_assets_latest_scan_id" ON "assets" ("latest_scan_id")`);

    // Backfill existing data: DISTINCT ON keeps the first row per asset, i.e. the newest successful scan.
    await queryRunner.query(`
      UPDATE "assets" a SET "latest_scan_id" = latest.id
      FROM (
        SELECT DISTINCT ON (asset_id) asset_id, id
        FROM "scans" WHERE status = 'success'
        ORDER BY asset_id, scanned_at DESC
      ) latest
      WHERE latest.asset_id = a.id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_assets_latest_scan_id"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP CONSTRAINT "fk_assets_latest_scan_id"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "latest_scan_id"`);
  }
}
