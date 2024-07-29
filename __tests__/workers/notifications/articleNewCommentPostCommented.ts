import { DataSource } from 'typeorm';
import worker, {
  Data,
} from '../../../src/workers/notifications/articleNewCommentPostCommented';
import createOrGetConnection from '../../../src/db';
import { Comment, Post, Source, User } from '../../../src/entity';
import { badUsersFixture, sourcesFixture, usersFixture } from '../../fixture';
import { postsFixture } from '../../fixture/post';
import { workers } from '../../../src/workers';
import { invokeNotificationWorker } from '../../helpers';

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
      flags: { vordr: false },
    },
    {
      id: 'c2',
      postId: 'p1',
      userId: '1',
      content: 'comment',
      contentHtml: '<p>comment</p>',
      flags: { vordr: true },
    },
  ]);
});

describe('articleNewCommentPostCommented', () => {
  it('should be registered', () => {
    const registeredWorker = workers.find(
      (item) => item.subscription === worker.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should not send notification when the comment is prevented by vordr', async () => {
    const payload: Data = {
      userId: '1',
      commentId: 'c2',
      postId: 'p1',
    };

    const result = await invokeNotificationWorker(
      worker,
      payload as unknown as Record<string, unknown>,
    );

    expect(result).toBeUndefined();
  });
});
