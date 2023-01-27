import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivatePost1674830540629 implements MigrationInterface {
  name = 'PrivatePost1674830540629';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post" ADD "private" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`update post set private = true from "source" where post."sourceId" = "source".id and "source".private = true
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "post" DROP COLUMN "private"`);
  }
}
