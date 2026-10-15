import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema: assets -> scans -> findings, with certificates shared between scans.
 *
 *   assets 1───* scans *───1 certificates
 *     │            │
 *     └──*  findings *──┘   (findings.asset_id is a denormalised shortcut)
 */
export class InitialSchema1792100000000 implements MigrationInterface {
  name = 'InitialSchema1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum order matters: Postgres sorts enum values in declaration order (worst first).
    await queryRunner.query(`CREATE TYPE "public"."asset_environment" AS ENUM('production', 'staging', 'development')`);
    await queryRunner.query(`CREATE TYPE "public"."risk_level" AS ENUM('critical', 'high', 'medium', 'low', 'none')`);
    await queryRunner.query(`CREATE TYPE "public"."scan_status" AS ENUM('success', 'failed')`);
    await queryRunner.query(`CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'high', 'medium', 'low')`);
    await queryRunner.query(`CREATE TYPE "public"."finding_category" AS ENUM('certificate', 'protocol', 'quantum')`);

    await queryRunner.query(`
      CREATE TABLE "assets" (
        "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
        "host"              character varying(253) NOT NULL,
        "port"              integer NOT NULL DEFAULT '443',
        "label"             character varying(100),
        "environment"       "public"."asset_environment" NOT NULL DEFAULT 'production',
        "latest_risk_score" smallint,
        "latest_risk_level" "public"."risk_level",
        "last_scanned_at"   TIMESTAMP WITH TIME ZONE,
        "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_assets" PRIMARY KEY ("id"),
        CONSTRAINT "uq_assets_host_port" UNIQUE ("host", "port")
      )`);
    await queryRunner.query(`CREATE INDEX "idx_assets_latest_risk_score" ON "assets" ("latest_risk_score")`);

    await queryRunner.query(`
      CREATE TABLE "certificates" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "fingerprint_sha256"  character varying(95) NOT NULL,
        "subject"             text NOT NULL,
        "issuer"              text NOT NULL,
        "serial_number"       character varying(128) NOT NULL,
        "subject_alt_names"   text array NOT NULL DEFAULT '{}',
        "valid_from"          TIMESTAMP WITH TIME ZONE NOT NULL,
        "valid_to"            TIMESTAMP WITH TIME ZONE NOT NULL,
        "key_algorithm"       character varying(20) NOT NULL,
        "key_size"            integer,
        "key_curve"           character varying(50),
        "signature_algorithm" character varying(100) NOT NULL,
        "signature_hash"      character varying(20),
        "self_signed"         boolean NOT NULL,
        "first_seen_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_certificates" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_certificates_fingerprint_sha256" ON "certificates" ("fingerprint_sha256")`);
    // "Which certificates expire soon?" is a core dashboard query.
    await queryRunner.query(`CREATE INDEX "idx_certificates_valid_to" ON "certificates" ("valid_to")`);

    await queryRunner.query(`
      CREATE TABLE "scans" (
        "id"                        uuid NOT NULL DEFAULT gen_random_uuid(),
        "asset_id"                  uuid NOT NULL,
        "status"                    "public"."scan_status" NOT NULL,
        "scanned_at"                TIMESTAMP WITH TIME ZONE NOT NULL,
        "duration_ms"               integer NOT NULL,
        "protocol"                  character varying(16),
        "cipher"                    character varying(100),
        "key_exchange"              character varying(50),
        "post_quantum_key_exchange" boolean,
        "trust_authorized"          boolean,
        "trust_error"               character varying(100),
        "error_code"                character varying(50),
        "error_message"             text,
        "risk_score"                smallint,
        "risk_level"                "public"."risk_level",
        "certificate_id"            uuid,
        CONSTRAINT "pk_scans" PRIMARY KEY ("id"),
        CONSTRAINT "fk_scans_asset_id" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "fk_scans_certificate_id" FOREIGN KEY ("certificate_id") REFERENCES "certificates"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    // Postgres does not index foreign keys automatically; without these, joins and cascades scan the table.
    await queryRunner.query(`CREATE INDEX "idx_scans_asset_id_scanned_at" ON "scans" ("asset_id", "scanned_at")`);
    await queryRunner.query(`CREATE INDEX "idx_scans_certificate_id" ON "scans" ("certificate_id")`);

    await queryRunner.query(`
      CREATE TABLE "findings" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "scan_id"        uuid NOT NULL,
        "asset_id"       uuid NOT NULL,
        "rule_id"        character varying(50) NOT NULL,
        "severity"       "public"."finding_severity" NOT NULL,
        "category"       "public"."finding_category" NOT NULL,
        "title"          character varying(200) NOT NULL,
        "description"    text NOT NULL,
        "recommendation" text NOT NULL,
        "evidence"       jsonb NOT NULL DEFAULT '{}',
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_findings" PRIMARY KEY ("id"),
        CONSTRAINT "fk_findings_scan_id" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "fk_findings_asset_id" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await queryRunner.query(`CREATE INDEX "idx_findings_scan_id" ON "findings" ("scan_id")`);
    await queryRunner.query(`CREATE INDEX "idx_findings_asset_id_created_at" ON "findings" ("asset_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "findings"`);
    await queryRunner.query(`DROP TABLE "scans"`);
    await queryRunner.query(`DROP TABLE "certificates"`);
    await queryRunner.query(`DROP TABLE "assets"`);
    await queryRunner.query(`DROP TYPE "public"."finding_category"`);
    await queryRunner.query(`DROP TYPE "public"."finding_severity"`);
    await queryRunner.query(`DROP TYPE "public"."scan_status"`);
    await queryRunner.query(`DROP TYPE "public"."risk_level"`);
    await queryRunner.query(`DROP TYPE "public"."asset_environment"`);
  }
}
