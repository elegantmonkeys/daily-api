import { DataSource } from 'typeorm';
import worker from '../../../src/workers/notifications/sourcePostModerationSubmittedNotification';
import createOrGetConnection from '../../../src/db';
import { Feed, Source, SourceType, User } from '../../../src/entity';
import { sourcesFixture, usersFixture } from '../../fixture';
import { workers } from '../../../src/workers';
import { invokeNotificationWorker, saveFixtures } from '../../helpers';
import { SourcePostModerationStatus } from '../../../src/entity/SourcePostModeration';
import { SourceMemberRoles } from '../../../src/roles';
import { NotificationPostModerationContext } from '../../../src/notifications';
import { ContentPreferenceSource } from '../../../src/entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../../../src/entity/contentPreference/types';

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
});

describe('SourcePostModerationSubmitted', () => {
  it('should be registered', () => {
    const registeredWorker = workers.find(
      (item) => item.subscription === worker.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should not send notification when the status is not pending', async () => {
    const post = {
      sourceId: 'a',
      status: SourcePostModerationStatus.Approved,
    };

    const result = await invokeNotificationWorker(worker, { post });

    expect(result).toBeUndefined();
  });

  it('should send notification to admins', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
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
    expect(result[0].type).toEqual('source_post_submitted');
    expect(ctx.post).toEqual(post);
    expect(ctx.userIds).toEqual(['1']);
  });

  it('should send notification to moderators', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
    };
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Moderator,
        referralToken: 'a',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_submitted');
    expect(ctx.post).toEqual(post);
    expect(ctx.userIds).toEqual(['1']);
  });

  it('should not send notification to members', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
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
    ]);

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_submitted');
    expect(ctx.post).toEqual(post);
    expect(ctx.userIds).toEqual(['1']);
    const noMembers = ctx.userIds.every((id) => id !== '3');
    expect(noMembers).toBeTruthy();
  });

  it('should not send notification to blocked members', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
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
          role: SourceMemberRoles.Blocked,
          referralToken: 'b',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
    ]);

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_submitted');
    expect(ctx.post).toEqual(post);
    expect(ctx.userIds).toEqual(['1']);
    const noMembers = ctx.userIds.every((id) => id !== '3');
    expect(noMembers).toBeTruthy();
  });

  it('should not send notification to post author', async () => {
    const post = {
      sourceId: 'a',
      createdById: '2',
      status: SourcePostModerationStatus.Pending,
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
          role: SourceMemberRoles.Blocked,
          referralToken: 'b',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
    ]);

    const result = await invokeNotificationWorker(worker, { post });
    const ctx = result[0].ctx as NotificationPostModerationContext;

    expect(result.length).toEqual(1);
    expect(result[0].type).toEqual('source_post_submitted');
    expect(ctx.post).toEqual(post);
    expect(ctx.userIds).toEqual(['1']);
    const noAuthor = ctx.userIds.every((id) => id !== '2');
    expect(noAuthor).toBeTruthy();
  });
});
