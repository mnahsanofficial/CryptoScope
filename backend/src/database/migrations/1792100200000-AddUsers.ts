import { MigrationInterface, QueryRunner } from 'typeorm';

/** Users for JWT login. Roles: admin (scan + manage) and viewer (read only). */
export class AddUsers1792100200000 implements MigrationInterface {
  name = 'AddUsers1792100200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."user_role" AS ENUM('admin', 'viewer')`);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "email"         character varying(254) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "role"          "public"."user_role" NOT NULL DEFAULT 'viewer',
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
  }
}
