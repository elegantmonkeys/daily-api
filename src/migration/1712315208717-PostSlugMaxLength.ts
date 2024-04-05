import { MigrationInterface, QueryRunner } from 'typeorm';

export class PostSlugMaxLength1712315208717 implements MigrationInterface {
  name = 'PostSlugMaxLength1712315208717';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "typeorm_metadata" REPLICA IDENTITY FULL`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_post_slug"`);
    await queryRunner.query(
      `ALTER TABLE "post" DROP CONSTRAINT "UQ_cd1bddce36edc3e766798eab376"`,
    );
    await queryRunner.query(`ALTER TABLE "post" DROP COLUMN "slug"`);
    await queryRunner.query(
      `DELETE FROM "public"."typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'slug', 'api', 'public', 'post'],
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD "slug" text GENERATED ALWAYS AS (trim(BOTH '-' FROM regexp_replace(lower(trim(COALESCE(LEFT(post.title,100),'')||'-'||post.id)), '[^a-z0-9-]+', '-', 'gi'))) STORED NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD CONSTRAINT "UQ_cd1bddce36edc3e766798eab376" UNIQUE ("slug")`,
    );
    await queryRunner.query(
      `INSERT INTO "public"."typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'api',
        'public',
        'post',
        'GENERATED_COLUMN',
        'slug',
        "trim(BOTH '-' FROM regexp_replace(lower(trim(COALESCE(LEFT(post.title,100),'')||'-'||post.id)), '[^a-z0-9-]+', '-', 'gi'))",
      ],
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_post_slug" ON "post" ("slug") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_post_slug"`);
    await queryRunner.query(
      `DELETE FROM "public"."typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'slug', 'api', 'public', 'post'],
    );
    await queryRunner.query(
      `ALTER TABLE "post" DROP CONSTRAINT "UQ_cd1bddce36edc3e766798eab376"`,
    );
    await queryRunner.query(`ALTER TABLE "post" DROP COLUMN "slug"`);
    await queryRunner.query(
      `INSERT INTO "public"."typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'api',
        'public',
        'post',
        'GENERATED_COLUMN',
        'slug',
        "trim(BOTH '-' FROM regexp_replace(lower(trim(COALESCE(post.title,'')||'-'||post.id)), '[^a-z0-9-]+', '-', 'gi'))",
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD "slug" text GENERATED ALWAYS AS (trim(BOTH '-' FROM regexp_replace(lower(trim(COALESCE(post.title,'')||'-'||post.id)), '[^a-z0-9-]+', '-', 'gi'))) STORED NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD CONSTRAINT "UQ_cd1bddce36edc3e766798eab376" UNIQUE ("slug")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_post_slug" ON "post" ("slug") `,
    );
  }
}
