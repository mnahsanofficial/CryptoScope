import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * assets.synthetic marks the seeded demo assets. Their domains are made up (cdn.initech-2410.ca), so a real
 * scan of them always ends in DNS_NOT_FOUND; the UI labels them and "Rescan riskiest" skips them.
 *
 * The backfill matches exactly the pattern the seed generates: <subdomain>.<org>-<number>.<tld> with the
 * seed's own word lists, so a real asset can't be caught by accident.
 */
export class AddAssetSynthetic1792100500000 implements MigrationInterface {
  name = 'AddAssetSynthetic1792100500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" ADD "synthetic" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`
      UPDATE "assets" SET "synthetic" = true
      WHERE host ~ '^(www|api|auth|vpn|mail|portal|payments|cdn|admin|sso|gateway|app)\\.(northwind|contoso|fabrikam|initech|umbrella|globex|acme|wayne|stark|hooli)-[0-9]+\\.(com|net|io|org|ca|co\\.uk)$'`);
    // Partial index: "riskiest real assets" reads only the handful of real rows instead of skipping 20,000 demo ones.
    await queryRunner.query(`CREATE INDEX "idx_assets_real_latest_risk_score" ON "assets" ("latest_risk_score") WHERE NOT "synthetic"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_assets_real_latest_risk_score"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "synthetic"`);
  }
}
