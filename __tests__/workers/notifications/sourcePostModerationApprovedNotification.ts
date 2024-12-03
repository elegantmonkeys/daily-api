import { DataSource } from 'typeorm';
import worker from '../../../src/workers/notifications/sourcePostModerationApprovedNotification';
import createOrGetConnection from '../../../src/db';
import { Feed, Post, Source, SourceType, User } from '../../../src/entity';
import { sourcesFixture, usersFixture } from '../../fixture';
import { workers } from '../../../src/workers';
import { invokeNotificationWorker, saveFixtures } from '../../helpers';
import { SourcePostModerationStatus } from '../../../src/entity/SourcePostModeration';
import { SourceMemberRoles } from '../../../src/roles';
import { NotificationPostModerationContext } from '../../../src/notifications';
import { postsFixture } from '../../fixture/post';
import { ContentPreferenceStatus } from '../../../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../../../src/entity/contentPreference/ContentPreferenceSource';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, User, usersFixture);
  await saveFixtures(
    con,
    Feed,
    usersFixture.map((u) => ({ id: u.id, userId: u.id })),
  );
  await saveFixtures(con, Post, postsFixture);
});

describe('SourcePostModerationSubmitted', () => {
  it('should be registered', () => {
    const registeredWorker = workers.find(
      (item) => item.subscription === worker.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should not send notification when status is not approved', async () => {
    const postRejected = {
      postId: 'p1',
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Rejected,
    };

    const rejected = await invokeNotificationWorker(worker, {
      post: postRejected,
    });
    expect(rejected).toBeUndefined();

    const postPending = {
      postId: 'p1',
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
    };

    const pending = await invokeNotificationWorker(worker, {
      post: postPending,
    });
    expect(pending).toBeUndefined();
  });

  it('should send notification to author only', async () => {
    const post = {
      postId: 'p1',
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Approved,
    };
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'a',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_approved');
    expect(ctx.post.id).toEqual('p1');
    expect(ctx.userIds).toEqual(['2']);
  });

  it('should not send notification other members', async () => {
    const post = {
      postId: 'p1',
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Approved,
    };
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Moderator,
          referralToken: 'a',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '3',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'b',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '4',
        flags: {
          role: SourceMemberRoles.Moderator,
          referralToken: 'c',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '4',
      },
    ]);

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_approved');
    expect(ctx.post.id).toEqual(post.postId);
    expect(ctx.userIds).toEqual(['2']);
    const ownerOnly = ctx.userIds.every((id) => id === '2');
    expect(ownerOnly).toBeTruthy();
  });
});
