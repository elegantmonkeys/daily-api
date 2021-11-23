import { Connection, getConnection } from 'typeorm';

import cron from '../../src/cron/updateViews';
import { expectSuccessfulCron, saveFixtures } from '../helpers';
import { Post, Source, View } from '../../src/entity';
import { sourcesFixture } from '../fixture/source';

let con: Connection;

beforeAll(async () => {
  con = await getConnection();
});

beforeEach(async () => {
  await saveFixtures(con, Source, sourcesFixture);
});

it('should update views and scores', async () => {
  const now = new Date();
  await saveFixtures(con, Post, [
    {
      id: 'p1',
      shortId: 'p1',
      title: 'P1',
      url: 'http://p1.com',
      score: 0,
      comments: 6,
      sourceId: 'a',
      createdAt: now,
    },
    {
      id: 'p2',
      shortId: 'p2',
      title: 'P2',
      url: 'http://p2.com',
      score: 0,
      sourceId: 'b',
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7),
      upvotes: 5,
    },
    {
      id: 'p3',
      shortId: 'p3',
      title: 'P3',
      url: 'http://p3.com',
      score: 0,
      sourceId: 'c',
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 40),
    },
  ]);
  await saveFixtures(con, View, [
    { postId: 'p1', userId: 'u1', timestamp: new Date(now.getTime()) },
    { postId: 'p1', userId: 'u2', timestamp: new Date(now.getTime() - 1) },
    { postId: 'p1', userId: 'u3', timestamp: new Date(now.getTime() - 2) },
    { postId: 'p1', userId: 'u4', timestamp: new Date(now.getTime() - 3) },
    { postId: 'p1', userId: 'u5', timestamp: new Date(now.getTime() - 4) },
    { postId: 'p2', userId: 'u4', timestamp: new Date(now.getTime() - 5) },
    { postId: 'p2', userId: 'u5', timestamp: new Date(now.getTime() - 6) },
  ]);

  await expectSuccessfulCron(cron);
  const posts = await con.getRepository(Post).find({
    select: ['id', 'views', 'score', 'createdAt'],
    order: { createdAt: 'ASC' },
  });
  expect(posts[0].views).toEqual(0);
  expect(posts[0].score).toEqual(0);
  expect(posts[1].views).toEqual(2);
  expect(posts[1].score).toEqual(
    Math.round(
      posts[1].createdAt.getTime() / (1000 * 60) +
        Math.pow(Math.log(2 + 5 * 2.5 + 1 + 10) / Math.log(5), 2) * 60,
    ),
  );
  expect(posts[2].views).toEqual(5);
  expect(posts[2].score).toEqual(
    Math.round(
      posts[2].createdAt.getTime() / (1000 * 60) +
        Math.pow(Math.log(5 + 6 * 4 + 1) / Math.log(5), 2) * 60,
    ),
  );
});
