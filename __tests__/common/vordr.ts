import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import { Comment, Post, Source, User } from '../../src/entity';
import { badUsersFixture, sourcesFixture, usersFixture } from '../fixture';
import { checkWithVordr } from '../../src/common/vordr';
import { Context } from '../../src/Context';
import { postsFixture } from '../fixture/post';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await con.getRepository(User).save(usersFixture);
  await con.getRepository(User).save(badUsersFixture);
  await con.getRepository(Source).save(sourcesFixture);
  await con.getRepository(Post).save(postsFixture);
  await con.getRepository(Comment).save([
    {
      id: 'c1',
      postId: 'p1',
      userId: '1',
      content: 'comment',
      contentHtml: '<p>comment</p>',
      flags: { vordr: true },
    },
    {
      id: 'c2',
      postId: 'p1',
      userId: '1',
      content: 'VordrWillCatchYou',
      contentHtml: '<p>comment</p>',
      flags: { vordr: true },
    },
  ]);
});

describe('commmon/vordr', () => {
  describe('checkWithVordr', () => {
    it('should return true if user har vordr flag set', async () => {
      const comment = await con
        .getRepository(Comment)
        .findOneByOrFail({ id: 'c1' });

      const result = await checkWithVordr(comment, {
        req: { ip: '127.0.0.1' },
        userId: 'vordr',
        con,
      } as Context);

      expect(result).toBeTruthy();
    });

    it('should return true if user has trust score 0', async () => {
      const comment = await con
        .getRepository(Comment)
        .findOneByOrFail({ id: 'c1' });

      const result = await checkWithVordr(comment, {
        req: { ip: '127.0.0.1' },
        userId: 'low-score',
        con,
      } as Context);

      expect(result).toBeTruthy();
    });

    it('should return true if the IP of the request is in the Vordr subnet', async () => {
      const comment = await con
        .getRepository(Comment)
        .findOneByOrFail({ id: 'c1' });

      const result = await checkWithVordr(comment, {
        req: { ip: '192.0.2.1' },
        userId: '1',
        con,
      } as Context);

      expect(result).toBeTruthy();
    });

    it('should return true if the comment contains a word on Vordr word list', async () => {
      const comment = await con
        .getRepository(Comment)
        .findOneByOrFail({ id: 'c2' });

      const result = await checkWithVordr(comment, {
        req: { ip: '127.0.0.1' },
        userId: '1',
        con,
      } as Context);

      expect(result).toBeTruthy();
    });

    it('should return false if it passes all Vordr filters', async () => {
      const comment = await con
        .getRepository(Comment)
        .findOneByOrFail({ id: 'c1' });

      const result = await checkWithVordr(comment, {
        req: { ip: '127.0.0.1' },
        userId: '1',
        con,
      } as Context);

      expect(result).toBeFalsy();
    });
  });
});
