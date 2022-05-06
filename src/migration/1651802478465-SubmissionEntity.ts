import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubmissionEntity1651802478465 implements MigrationInterface {
  name = 'SubmissionEntity1651802478465';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post" ADD "scoutId" character varying(36)`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD CONSTRAINT "FK_a51326b93176f2b2ebf3eda9fef" FOREIGN KEY ("scoutId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "submission" ("url" text NOT NULL, "userId" character varying(36) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "status" character varying NOT NULL DEFAULT 'NOT_STARTED', CONSTRAINT "PK_5939386ba1e4c482272449f7ad9" PRIMARY KEY ("url"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7bd626272858ef6464aa257909" ON "submission" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "submission" ADD CONSTRAINT "FK_7bd626272858ef6464aa2579094" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "submission" REPLICA IDENTITY FULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post" DROP CONSTRAINT "FK_a51326b93176f2b2ebf3eda9fef"`,
    );
    await queryRunner.query(`ALTER TABLE "post" DROP COLUMN "scoutId"`);
    await queryRunner.query(
      `ALTER TABLE "submission" REPLICA IDENTITY DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission" DROP CONSTRAINT "FK_7bd626272858ef6464aa2579094"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7bd626272858ef6464aa257909"`,
    );
    await queryRunner.query(`DROP TABLE "submission"`);
  }
}
