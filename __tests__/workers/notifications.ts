import { invokeNotificationWorker, saveFixtures } from '../helpers';
import {
  Bookmark,
  Comment,
  Feed,
  MachineSource,
  NotificationPreferenceComment,
  NotificationPreferencePost,
  NotificationPreferenceSource,
  NotificationPreferenceUser,
  Post,
  PostMention,
  PostReport,
  PostType,
  Settings,
  Source,
  SourceType,
  SquadSource,
  SubmissionStatus,
  User,
  UserAction,
  UserActionType,
  UserPost,
  UserStreak,
} from '../../src/entity';
import { SourceMemberRoles } from '../../src/roles';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import { usersFixture, sourcesFixture, badUsersFixture } from '../fixture';
import { postsFixture } from '../fixture/post';
import {
  NotificationBookmarkContext,
  NotificationCommentContext,
  NotificationCommenterContext,
  NotificationDoneByContext,
  NotificationPostContext,
  NotificationSourceContext,
  NotificationSourceRequestContext,
  NotificationStreakContext,
  NotificationUpvotersContext,
  NotificationUserContext,
} from '../../src/notifications';
import {
  NotificationPreferenceStatus,
  NotificationType,
} from '../../src/notifications/common';
import {
  createSquadWelcomePost,
  NotificationReason,
  updateFlagsStatement,
} from '../../src/common';
import { randomUUID } from 'crypto';
import { ChangeObject, UserVote } from '../../src/types';
import { UserComment } from '../../src/entity/user/UserComment';
import { workers } from '../../src/workers';
import { generateStorageKey, StorageKey, StorageTopic } from '../../src/config';
import { ioRedisPool, setRedisObject } from '../../src/redis';
import { ReportReason } from '../../src/entity/common';
import { ContentPreferenceUser } from '../../src/entity/contentPreference/ContentPreferenceUser';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../../src/entity/contentPreference/ContentPreferenceSource';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();
  await con.getRepository(User).save(usersFixture);
  await saveFixtures(
    con,
    Feed,
    usersFixture.map((u) => ({ id: u.id, userId: u.id })),
  );
  await con.getRepository(MachineSource).save(sourcesFixture);
  await con.getRepository(Post).save([postsFixture[0], postsFixture[1]]);
  await con.getRepository(Comment).save([
    {
      id: 'c1',
      postId: 'p1',
      userId: '2',
      content: 'comment',
      contentHtml: '<p>comment</p>',
    },
  ]);
  await con
    .getRepository(UserAction)
    .save({ userId: '1', type: UserActionType.SquadFirstPost });
});

it('should add community picks failed notification', async () => {
  const worker = await import(
    '../../src/workers/notifications/communityPicksFailed'
  );
  const actual = await invokeNotificationWorker(worker.default, {
    id: 'sr1',
    url: 'http://sample.abc.com',
    userId: '1',
    createdAt: 1601187916999999,
    status: SubmissionStatus.Rejected,
  });
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual('community_picks_failed');
  expect(actual[0].ctx).toEqual({
    userIds: ['1'],
    submission: {
      id: 'sr1',
      url: 'http://sample.abc.com',
      userId: '1',
      createdAt: 1601187916999999,
      status: SubmissionStatus.Rejected,
    },
  });
});

it('should add community picks granted notification', async () => {
  const worker = await import(
    '../../src/workers/notifications/communityPicksGranted'
  );
  const actual = await invokeNotificationWorker(worker.default, {
    userId: '1',
  });
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual('community_picks_granted');
  expect(actual[0].ctx).toEqual({
    userIds: ['1'],
  });
});

it('should add devcard unlocked notification if user has reached the reputation threshold', async () => {
  const worker = await import(
    '../../src/workers/notifications/devCardUnlocked'
  );
  const actual = await invokeNotificationWorker(worker.default, {
    user: {
      id: '1',
      reputation: 10,
    },
    userAfter: {
      id: '1',
      reputation: 21,
    },
  });
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual('dev_card_unlocked');
  expect(actual[0].ctx).toEqual({
    userIds: ['1'],
  });
});

it('should NOT add devcard unlocked notification if user has NOT reached the reputation threshold', async () => {
  const worker = await import(
    '../../src/workers/notifications/devCardUnlocked'
  );
  const actual = await invokeNotificationWorker(worker.default, {
    user: {
      id: '1',
      reputation: 10,
    },
    userAfter: {
      id: '1',
      reputation: 15,
    },
  });
  expect(actual).toBeUndefined();
});

it('should NOT add devcard unlocked notification if user had already reached the dev card threshold', async () => {
  const worker = await import(
    '../../src/workers/notifications/devCardUnlocked'
  );
  const actual = await invokeNotificationWorker(worker.default, {
    user: {
      id: '1',
      reputation: 30,
    },
    userAfter: {
      id: '1',
      reputation: 40,
    },
  });
  expect(actual).toBeUndefined();
});

describe('squad featured updated notification', () => {
  const squad = {
    ...sourcesFixture[0],
    type: SourceType.Squad,
    flags: { featured: true },
  };

  beforeEach(async () => {
    await saveFixtures(con, User, badUsersFixture);
    await saveFixtures(
      con,
      Feed,
      badUsersFixture.map((u) => ({ id: u.id, userId: u.id })),
    );
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 't1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 't2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '3',
        flags: {
          role: SourceMemberRoles.Moderator,
          referralToken: 't3',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '4',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 't4',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '4',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: 'low-score',
        flags: {
          role: SourceMemberRoles.Blocked,
          referralToken: 't5',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: 'low-score',
      },
    ]);
  });

  it('should be registered', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadFeaturedUpdated'
    );

    const registeredWorker = workers.find(
      (item) => item.subscription === worker.default.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should not do anything when squad is not featured', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadFeaturedUpdated'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      squad: { ...squad, flags: { featured: false } },
    });
    expect(actual).toBeFalsy();
  });

  it('should send notification to admins', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadFeaturedUpdated'
    );
    const actual = await invokeNotificationWorker(worker.default, { squad });
    const source = await con.getRepository(Source).findOneBy({ id: squad.id });

    expect(actual).toBeTruthy();
    expect(actual![0].type).toEqual('squad_featured');
    expect((actual![0].ctx as NotificationSourceContext).source.id).toEqual(
      source!.id,
    );
    const admins = await con
      .getRepository(ContentPreferenceSource)
      .createQueryBuilder()
      .where(`flags->>'role' = :role`, { role: SourceMemberRoles.Admin })
      .getMany();
    const adminsFound = admins.every((admin) =>
      actual![0].ctx.userIds.includes(admin.userId),
    );
    expect(adminsFound).toBeTruthy;
  });

  it('should send notification to moderators', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadFeaturedUpdated'
    );
    const actual = await invokeNotificationWorker(worker.default, { squad });
    const source = await con.getRepository(Source).findOneBy({ id: squad.id });

    expect(actual).toBeTruthy();
    expect(actual![0].type).toEqual('squad_featured');
    expect((actual![0].ctx as NotificationSourceContext).source.id).toEqual(
      source!.id,
    );
    const mods = await con
      .getRepository(ContentPreferenceSource)
      .createQueryBuilder()
      .where(`flags->>'role' = :role`, { role: SourceMemberRoles.Moderator })
      .getMany();
    const modsFound = mods.every((mod) =>
      actual![0].ctx.userIds.includes(mod.userId),
    );
    expect(modsFound).toBeTruthy;
  });

  it('should not send notification to regular members', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadFeaturedUpdated'
    );
    const actual = await invokeNotificationWorker(worker.default, { squad });
    const source = await con.getRepository(Source).findOneBy({ id: squad.id });

    expect(actual).toBeTruthy();
    expect(actual![0].type).toEqual('squad_featured');
    expect((actual![0].ctx as NotificationSourceContext).source.id).toEqual(
      source!.id,
    );
    const members = await con
      .getRepository(ContentPreferenceSource)
      .createQueryBuilder()
      .where(`flags->>'role' = :role`, { role: SourceMemberRoles.Member })
      .getMany();
    const membersNotFound = members.every(
      (member) => !actual![0].ctx.userIds.includes(member.userId),
    );
    expect(membersNotFound).toBeTruthy;
  });

  it('should not send notification to blocked members', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadFeaturedUpdated'
    );
    const actual = await invokeNotificationWorker(worker.default, { squad });
    const source = await con.getRepository(Source).findOneBy({ id: squad.id });

    expect(actual).toBeTruthy();
    expect(actual![0].type).toEqual('squad_featured');
    expect((actual![0].ctx as NotificationSourceContext).source.id).toEqual(
      source!.id,
    );
    const blocked = await con
      .getRepository(ContentPreferenceSource)
      .createQueryBuilder()
      .where(`flags->>'role' = :role`, { role: SourceMemberRoles.Blocked })
      .getMany();
    const blockedNotFound = blocked.every(
      (member) => !actual![0].ctx.userIds.includes(member.userId),
    );
    expect(blockedNotFound).toBeTruthy;
  });
});

describe('source member role changed', () => {
  const baseMember: ChangeObject<ContentPreferenceSource> = {
    userId: '1',
    sourceId: 'squad',
    referenceId: 'squad',
    flags: {
      role: SourceMemberRoles.Member,
      referralToken: 'rt1',
    },
    feedId: '1',
    status: ContentPreferenceStatus.Subscribed,
    type: ContentPreferenceType.Source,
    createdAt: Date.now(),
  };

  it('should add blocked notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Member,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Blocked,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('squad_blocked');
    expect(actual[0].ctx).toEqual({ userIds: ['1'], source });
  });
  it('should add member to moderator notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Member,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Moderator,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });

    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('promoted_to_moderator');
    expect(actual[0].ctx).toEqual({ userIds: ['1'], source });
  });
  it('should add member to admin notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Member,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Admin,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });

    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('promoted_to_admin');
    expect(actual[0].ctx).toEqual({
      userIds: ['1'],
      source,
    });
  });
  it('should add moderator to member notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Moderator,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Member,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });

    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('demoted_to_member');
    expect(actual[0].ctx).toEqual({
      userIds: ['1'],
      role: SourceMemberRoles.Moderator,
      source,
    });
  });
  it('should add moderator to admin notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Moderator,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Admin,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('promoted_to_admin');
    expect(actual[0].ctx).toEqual({
      userIds: ['1'],
      source,
    });
  });
  it('should add admin to member notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Admin,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Member,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });

    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('demoted_to_member');
    expect(actual[0].ctx).toEqual({
      userIds: ['1'],
      role: SourceMemberRoles.Admin,
      source,
    });
  });
  it('should add admin to moderator notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceMemberRoleChanged'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      previousRole: SourceMemberRoles.Admin,
      sourceMember: {
        ...baseMember,
        flags: {
          ...baseMember.flags,
          role: SourceMemberRoles.Moderator,
        },
      },
    });
    const source = await con.getRepository(Source).findOneBy({ id: 'squad' });

    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('promoted_to_moderator');
    expect(actual[0].ctx).toEqual({
      userIds: ['1'],
      source,
    });
  });
});

describe('post added notifications', () => {
  it('should not add any notification if post is a welcome post', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { authorId: '1', type: PostType.Welcome });
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '2',
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'random',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '2',
    });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual).toBeFalsy();
  });

  it('should add article picked notification', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('article_picked');
    const ctx = actual[0].ctx as NotificationPostContext;
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    const source = await con.getRepository(Source).findOneBy({ id: 'a' });
    expect(ctx.userIds).toEqual(['1']);
    expect(ctx.post.id).toEqual(post.id);
    expect(ctx.source).toEqual(source);
    expect(ctx.sharedPost).toBeFalsy();
  });

  it('should insert or ignore completed action for squad first post', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    const repo = con.getRepository(UserAction);
    await con
      .getRepository(UserAction)
      .delete({ userId: '1', type: UserActionType.SquadFirstPost });
    const getAction = () =>
      repo.findOneBy({
        userId: '1',
        type: UserActionType.SquadFirstPost,
      });
    const exists = await getAction();
    expect(exists).toBeFalsy();
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con
      .getRepository(Post)
      .update(
        { id: 'p1' },
        { authorId: '1', sourceId: 'a', type: PostType.Share },
      );
    await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    const inserted = await getAction();
    expect(inserted).toBeTruthy();

    await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });

    const sameAction = await getAction();
    expect(sameAction.completedAt).toEqual(sameAction.completedAt);
  });

  it('should not add completed action for first post if source is not squad', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    await con
      .getRepository(UserAction)
      .delete({ userId: '1', type: UserActionType.SquadFirstPost });
    await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    const exists = await con.getRepository(UserAction).findOneBy({
      userId: '1',
      type: UserActionType.SquadFirstPost,
    });
    expect(exists).toBeFalsy();
  });

  it('should not add article picked notification on blocked members', async () => {
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).insert({
      sourceId: 'a',
      referenceId: 'a',
      userId: '2',
      flags: {
        role: SourceMemberRoles.Blocked,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '2',
    });
    const worker = await import('../../src/workers/notifications/postAdded');
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(0);
  });

  it('should not add article picked notification for private post', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        authorId: '1',
        private: true,
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(0);
  });

  it('should add community picks succeeded notification', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con.getRepository(Post).update({ id: 'p1' }, { scoutId: '1' });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('community_picks_succeeded');
    const ctx = actual[0].ctx as NotificationPostContext;
    const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
    const source = await con.getRepository(Source).findOneBy({ id: 'a' });
    expect(ctx.userIds).toEqual(['1']);
    expect(ctx.post.id).toEqual(post.id);
    expect(ctx.source).toEqual(source);
    expect(ctx.sharedPost).toBeFalsy();
  });

  it('should not add notification when there is no author', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    const post = postsFixture[0];
    const actual = await invokeNotificationWorker(worker.default, { post });
    expect(actual.length).toEqual(0);
  });

  it('should add post added notification to all source members except the author', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '3',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
    ]);
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('squad_post_added');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationDoneByContext).doneBy.id).toEqual('1');
    expect(bundle.ctx.userIds).toIncludeSameMembers(['2', '3']);
  });

  it('should add post added notification to all source members except the author and mentioned user', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '3',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
    ]);
    await con.getRepository(PostMention).save({
      postId: 'p1',
      mentionedByUserId: '1',
      mentionedUserId: '3',
    });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('squad_post_added');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationDoneByContext).doneBy.id).toEqual('1');
    expect(bundle.ctx.userIds).toIncludeSameMembers(['2']);
  });

  it('should add post added notification to all source members except the author and muted members', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '3',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
    ]);
    await con.getRepository(NotificationPreferenceSource).save({
      userId: '3',
      sourceId: 'a',
      referenceId: 'a',
      status: NotificationPreferenceStatus.Muted,
      notificationType: NotificationType.SquadPostAdded,
    });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('squad_post_added');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationDoneByContext).doneBy.id).toEqual('1');
    expect(bundle.ctx.userIds).toEqual(['2']);
  });

  const prepareSubscribeTests = async (postId = 'p1', sourceId = 'a') => {
    await con
      .getRepository(Source)
      .update({ id: sourceId }, { type: SourceType.Squad });
    await con
      .getRepository(Post)
      .update({ id: postId }, { authorId: '1', type: PostType.Share });
  };

  it('should not add squad subscribe to notification when user has made many posts already', async () => {
    await prepareSubscribeTests();
    await con
      .getRepository(UserAction)
      .save({ userId: '1', type: UserActionType.SquadFirstPost });
    const worker = await import('../../src/workers/notifications/postAdded');
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    const subscribe = actual.some(
      ({ type }) => type === NotificationType.SquadSubscribeToNotification,
    );
    expect(subscribe).toBeFalsy();
  });

  it('should not add squad subscribe to notification when user has subscribe in the past already', async () => {
    await prepareSubscribeTests();
    await con
      .getRepository(UserAction)
      .save({ userId: '1', type: UserActionType.EnableNotification });
    const worker = await import('../../src/workers/notifications/postAdded');
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    const subscribe = actual.some(
      ({ type }) => type === NotificationType.SquadSubscribeToNotification,
    );
    expect(subscribe).toBeFalsy();
  });

  it('should add source post added notification to all source members', async () => {
    const worker = await import('../../src/workers/notifications/postAdded');
    await con.getRepository(NotificationPreferenceSource).save({
      userId: '3',
      sourceId: 'a',
      referenceId: 'a',
      status: NotificationPreferenceStatus.Subscribed,
      notificationType: NotificationType.SourcePostAdded,
    });
    const actual = await invokeNotificationWorker(worker.default, {
      post: postsFixture[0],
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual(NotificationType.SourcePostAdded);
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect(bundle.ctx.userIds).toEqual(['3']);
  });
});

describe('post bookmark reminder', () => {
  it('should be registered', async () => {
    const worker = await import(
      '../../src/workers/notifications/postBookmarkReminder'
    );

    const registeredWorker = workers.find(
      (item) => item.subscription === worker.default.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should add notification for the user that set the reminder', async () => {
    const worker = await import(
      '../../src/workers/notifications/postBookmarkReminder'
    );
    const remindAt = new Date();
    await con
      .getRepository(Bookmark)
      .save({ userId: '1', postId: 'p1', remindAt });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    const ctx = bundle.ctx as NotificationPostContext &
      NotificationBookmarkContext;
    expect(bundle.type).toEqual('post_bookmark_reminder');
    expect(ctx.post.id).toEqual('p1');
    expect(ctx.source.id).toEqual('a');
    expect(ctx.bookmark.userId).toEqual('1');
    expect(ctx.bookmark.postId).toEqual('p1');
    expect(ctx.bookmark.remindAt).toEqual(remindAt);
  });

  it('should not add notification if the reminder has been removed', async () => {
    const worker = await import(
      '../../src/workers/notifications/postBookmarkReminder'
    );
    await con.getRepository(Bookmark).save({ userId: '1', postId: 'p1' });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
    });
    expect(actual).toBeFalsy();
  });

  it('should not add notification if the post is not found', async () => {
    const worker = await import(
      '../../src/workers/notifications/postBookmarkReminder'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1notfound',
    });
    expect(actual).toBeFalsy();
  });
});

describe('streak reset restore', () => {
  beforeEach(async () => {
    await ioRedisPool.execute((client) => client.flushall());
  });

  it('should be registered', async () => {
    const worker = await import(
      '../../src/workers/notifications/userStreakResetNotification'
    );

    const registeredWorker = workers.find(
      (item) => item.subscription === worker.default.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should add notification for the user to restore their streak', async () => {
    const worker = await import(
      '../../src/workers/notifications/userStreakResetNotification'
    );
    const lastViewAt = new Date();
    const lastStreak = 10;
    const streak = await con
      .getRepository(UserStreak)
      .save({ userId: '1', currentStreak: 0, lastViewAt });
    const key = generateStorageKey(
      StorageTopic.Streak,
      StorageKey.Reset,
      streak.userId,
    );
    const debeziumTime = streak.lastViewAt.getTime();
    await setRedisObject(key, lastStreak.toString());
    const actual = await invokeNotificationWorker(worker.default, {
      streak: { ...streak, lastViewAt: debeziumTime },
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    const ctx = bundle.ctx as NotificationStreakContext;
    expect(bundle.type).toEqual('streak_reset_restore');
    expect(ctx.streak.currentStreak).toEqual(lastStreak);
    expect(ctx.streak.lastViewAt).toEqual(debeziumTime);
  });

  it('should not add notification if the stored value has expired', async () => {
    const worker = await import(
      '../../src/workers/notifications/userStreakResetNotification'
    );
    const lastViewAt = new Date();
    const streak = await con
      .getRepository(UserStreak)
      .save({ userId: '1', currentStreak: 0, lastViewAt });
    const actual = await invokeNotificationWorker(worker.default, { streak });
    expect(actual).toBeUndefined();
  });

  it('should not add notification if the user opted out of streaks', async () => {
    const worker = await import(
      '../../src/workers/notifications/userStreakResetNotification'
    );
    const lastViewAt = new Date();
    const lastStreak = 10;
    const streak = await con
      .getRepository(UserStreak)
      .save({ userId: '1', currentStreak: 0, lastViewAt });
    const key = generateStorageKey(
      StorageTopic.Streak,
      StorageKey.Reset,
      streak.userId,
    );
    await setRedisObject(key, lastStreak.toString());
    await con
      .getRepository(Settings)
      .save({ userId: '1', optOutReadingStreak: true });
    const actual = await invokeNotificationWorker(worker.default, { streak });
    expect(actual).toBeUndefined();
  });

  it('should not add notification if the stored value is not a number', async () => {
    const worker = await import(
      '../../src/workers/notifications/userStreakResetNotification'
    );
    const lastViewAt = new Date();
    const streak = await con
      .getRepository(UserStreak)
      .save({ userId: '1', currentStreak: 0, lastViewAt });
    const key = generateStorageKey(
      StorageTopic.Streak,
      StorageKey.Reset,
      streak.userId,
    );
    await setRedisObject(key, '1test');
    const actual = await invokeNotificationWorker(worker.default, { streak });
    expect(actual).toBeUndefined();
  });
});

describe('article new comment', () => {
  it('should add notification for scout and author', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '3',
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('article_new_comment');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationCommentContext).comment.id).toEqual('c1');
    expect((bundle.ctx as NotificationCommenterContext).commenter.id).toEqual(
      '2',
    );
    expect(actual[0].ctx.userIds).toIncludeSameMembers(['1', '3']);
  });

  it('should add one notification when scout and author are the same', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '1',
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].ctx.userIds).toEqual(['1']);
  });

  it('should not add notification when the author commented', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        authorId: '1',
      },
    );
    await con.getRepository(Comment).update(
      { id: 'c1' },
      {
        userId: '1',
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual).toBeFalsy();
  });

  it('should not add notification for scout and author when they are following a thread as they will receive one from reply', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentCommentCommented'
    );
    const repo = con.getRepository(Comment);
    await repo.save([
      {
        id: 'c2',
        postId: 'p1',
        parentId: 'c1',
        userId: '3',
        content: 'a',
      },
      {
        id: 'c3',
        postId: 'p1',
        parentId: 'c1',
        userId: '1',
        content: 'a',
      },
    ]);
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '3',
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      childCommentId: 'c3',
    });
    expect(actual).toBeFalsy();
  });

  it('should add notification for scout and author on new reply', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentCommentCommented'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '3',
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      childCommentId: 'c1',
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].ctx.userIds).toIncludeSameMembers(['1', '3']);
  });

  it('should add notification but ignore users with muted settings', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentCommentCommented'
    );
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { scoutId: '1', authorId: '3' });
    await con.getRepository(NotificationPreferencePost).save({
      userId: '1',
      postId: 'p1',
      referenceId: 'p1',
      status: NotificationPreferenceStatus.Muted,
      notificationType: NotificationType.ArticleNewComment,
    });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      childCommentId: 'c1',
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].ctx.userIds).toEqual(['3']);
  });

  it('should insert or ignore completed action type first post comment', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentCommentCommented'
    );
    const repo = con.getRepository(UserAction);
    const getAction = () =>
      repo.findOneBy({
        userId: '1',
        type: UserActionType.SquadFirstComment,
      });
    const exists = await getAction();
    await con.getRepository(Comment).update({ id: 'c1' }, { userId: '1' });
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    expect(exists).toBeFalsy();

    await invokeNotificationWorker(worker.default, {
      postId: 'p1',
      childCommentId: 'c1',
    });

    const inserted = await getAction();
    expect(inserted).toBeTruthy();

    await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      childCommentId: 'c1',
    });

    const existing = await getAction();
    expect(existing).toBeTruthy();
    expect(existing.completedAt).toEqual(inserted.completedAt);
  });

  it('should not insert completed action type first post comment if source is not squad', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentCommentCommented'
    );

    await con.getRepository(Comment).update({ id: 'c1' }, { userId: '1' });
    await invokeNotificationWorker(worker.default, {
      postId: 'p1',
      childCommentId: 'c1',
    });
    const exists = await con.getRepository(UserAction).findOneBy({
      userId: '1',
      type: UserActionType.SquadFirstComment,
    });
    expect(exists).toBeFalsy();
  });

  it('should not add notification for new squad comment when author is blocked from squad', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(ContentPreferenceSource).update(
      { sourceId: 'a', userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual).toBeFalsy();
  });

  it('should not add notification for new squad comment when author is not par of the squad anymore', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con
      .getRepository(ContentPreferenceSource)
      .delete({ referenceId: 'a', userId: '1' });
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual).toBeFalsy();
  });

  it('should add notification for new squad comment', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        authorId: '1',
      },
    );
    await con.getRepository(ContentPreferenceSource).insert({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      createdAt: new Date(),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual.length).toEqual(1);
    actual.forEach((bundle) => {
      expect(bundle.type).toEqual('squad_new_comment');
      expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
      expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
      expect((bundle.ctx as NotificationCommentContext).comment.id).toEqual(
        'c1',
      );
      expect((bundle.ctx as NotificationCommenterContext).commenter.id).toEqual(
        '2',
      );
    });

    expect(actual[0].ctx.userIds).toEqual(['1']);
  });

  it('should add notification for new squad comment but ignore muted users', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleNewCommentPostCommented'
    );
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        authorId: '1',
      },
    );
    await con.getRepository(ContentPreferenceSource).insert({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      createdAt: new Date(),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
    await con.getRepository(NotificationPreferencePost).save({
      userId: '1',
      postId: 'p1',
      referenceId: 'p1',
      status: NotificationPreferenceStatus.Muted,
      notificationType: NotificationType.SquadNewComment,
    });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
      commentId: 'c1',
    });
    expect(actual).toBeFalsy();
  });
});

describe('article upvote milestone', () => {
  it('should not add notification when scout/author is not member anymore', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleUpvoteMilestone'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '3',
        upvotes: 5,
      },
    );
    await con.getRepository(UserPost).save([
      {
        userId: '2',
        postId: 'p1',
        vote: UserVote.Up,
      },
      { userId: '4', postId: 'p1', vote: UserVote.Up },
    ]);
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    const repo = con.getRepository(ContentPreferenceSource);
    await repo.update(
      { userId: '1', sourceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await repo.delete({ userId: '3', sourceId: 'a' });
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '2',
      postId: 'p1',
    });
    expect(actual).toBeFalsy();
  });

  it('should add notification for scout and author', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleUpvoteMilestone'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '3',
        upvotes: 3,
      },
    );
    await con.getRepository(UserPost).save([
      {
        userId: '2',
        postId: 'p1',
        vote: UserVote.Up,
      },
      { userId: '4', postId: 'p1', vote: UserVote.Up },
    ]);
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '2',
      postId: 'p1',
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('article_upvote_milestone');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationUpvotersContext).upvotes).toEqual(5);
    expect((bundle.ctx as NotificationUpvotersContext).upvoters.length).toEqual(
      2,
    );
    expect(bundle.ctx.userIds).toIncludeSameMembers(['1', '3']);
  });

  it('should add one notification when scout and author are the same', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleUpvoteMilestone'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        scoutId: '1',
        authorId: '1',
        upvotes: 5,
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '2',
      postId: 'p1',
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].ctx.userIds).toEqual(['1']);
  });

  it('should not add notification when the author upvoted', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleUpvoteMilestone'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        authorId: '1',
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      postId: 'p1',
    });
    expect(actual).toBeFalsy();
  });

  it('should not add notification if it is not milestone', async () => {
    const worker = await import(
      '../../src/workers/notifications/articleUpvoteMilestone'
    );
    await con.getRepository(Post).update(
      { id: 'p1' },
      {
        authorId: '1',
        upvotes: 11,
      },
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '2',
      postId: 'p1',
    });
    expect(actual).toBeFalsy();
  });
});

it('should add article report approved notification for every reporter', async () => {
  const worker = await import(
    '../../src/workers/notifications/articleReportApproved'
  );
  await con.getRepository(PostReport).save([
    { userId: '1', postId: 'p1', reason: ReportReason.Nsfw },
    { userId: '2', postId: 'p1', reason: ReportReason.Clickbait },
  ]);
  const post = await con.getRepository(Post).findOneBy({ id: 'p1' });
  const actual = await invokeNotificationWorker(worker.default, {
    post,
  });
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual('article_report_approved');
  expect(actual[0].ctx.userIds).toIncludeSameMembers(['1', '2']);
  expect((actual[0].ctx as NotificationPostContext).post.id).toEqual('p1');
  expect((actual[0].ctx as NotificationPostContext).source.id).toEqual('a');
});

it('should add article analytics notification for scout and author', async () => {
  const worker = await import(
    '../../src/workers/notifications/articleAnalytics'
  );
  await con.getRepository(Post).update(
    { id: 'p1' },
    {
      authorId: '1',
      scoutId: '3',
    },
  );
  const actual = await invokeNotificationWorker(worker.default, {
    postId: 'p1',
  });
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual('article_analytics');
  expect(actual[0].ctx.userIds).toIncludeSameMembers(['3', '1']);
  expect((actual[0].ctx as NotificationPostContext).post.id).toEqual('p1');
  expect((actual[0].ctx as NotificationPostContext).source.id).toEqual('a');
});

describe('source request', () => {
  it('should add source approved notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceRequest'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      reason: NotificationReason.Publish,
      sourceRequest: {
        id: 'sr1',
        userId: '1',
        sourceId: sourcesFixture[0].id,
      },
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('source_approved');
    expect(actual[0].ctx.userIds).toEqual(['1']);
    expect(
      (actual[0].ctx as NotificationSourceRequestContext).sourceRequest.id,
    ).toEqual('sr1');
    expect((actual[0].ctx as NotificationSourceContext).source.id).toEqual('a');
  });

  it('should add source rejected notification', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceRequest'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      reason: NotificationReason.Decline,
      sourceRequest: {
        id: 'sr1',
        userId: '1',
        sourceId: sourcesFixture[0].id,
      },
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('source_rejected');
    expect(actual[0].ctx.userIds).toEqual(['1']);
    expect(
      (actual[0].ctx as NotificationSourceRequestContext).sourceRequest.id,
    ).toEqual('sr1');
  });

  it('should add source rejected notification on existing source', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceRequest'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      reason: NotificationReason.Exists,
      sourceRequest: {
        id: 'sr1',
        userId: '1',
        sourceId: sourcesFixture[0].id,
      },
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('source_rejected');
    expect(actual[0].ctx.userIds).toEqual(['1']);
    expect(
      (actual[0].ctx as NotificationSourceRequestContext).sourceRequest.id,
    ).toEqual('sr1');
  });

  it('should do nothing otherwise', async () => {
    const worker = await import(
      '../../src/workers/notifications/sourceRequest'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      reason: NotificationReason.New,
      sourceRequest: {
        id: 'sr1',
        userId: '1',
        sourceId: sourcesFixture[0].id,
      },
    });
    expect(actual).toBeFalsy();
  });
});

it('should add post mention notification', async () => {
  const worker = await import('../../src/workers/notifications/postMention');
  const actual = await invokeNotificationWorker(worker.default, {
    postMention: {
      postId: 'p1',
      mentionedUserId: '2',
      mentionedByUserId: '1',
    },
  });
  type Context = NotificationPostContext & NotificationDoneByContext;
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual('post_mention');
  expect(actual[0].ctx.userIds).toEqual(['2']);
  expect((actual[0].ctx as Context).post.id).toEqual('p1');
  expect((actual[0].ctx as Context).source.id).toEqual('a');
  expect((actual[0].ctx as Context).doneBy.id).toEqual('1');
});

it('should add comment mention notification', async () => {
  const worker = await import('../../src/workers/notifications/commentMention');
  const actual = await invokeNotificationWorker(worker.default, {
    commentMention: {
      commentId: 'c1',
      mentionedUserId: '1',
      commentUserId: '2',
    },
  });
  expect(actual.length).toEqual(1);
  expect(actual[0].type).toEqual(NotificationType.CommentMention);
  expect(actual[0].ctx.userIds).toEqual(['1']);
  expect((actual[0].ctx as NotificationPostContext).post.id).toEqual('p1');
  expect((actual[0].ctx as NotificationPostContext).source.id).toEqual('a');
  expect((actual[0].ctx as NotificationCommentContext).comment.id).toEqual(
    'c1',
  );
  expect((actual[0].ctx as NotificationCommenterContext).commenter.id).toEqual(
    '2',
  );
});

it('should not add comment mention notification when you mentioned the author', async () => {
  const mentionedUserId = '1';
  await con
    .getRepository(Post)
    .update({ id: 'p1' }, { authorId: mentionedUserId });
  const worker = await import('../../src/workers/notifications/commentMention');
  const actual = await invokeNotificationWorker(worker.default, {
    commentMention: {
      commentId: 'c1',
      commentUserId: '2',
      mentionedUserId,
    },
  });
  expect(actual).toBeFalsy();
});

it('should not add comment mention notification when you mentioned the scout', async () => {
  const mentionedUserId = '1';
  await con
    .getRepository(Post)
    .update({ id: 'p1' }, { authorId: mentionedUserId });
  const worker = await import('../../src/workers/notifications/commentMention');
  const actual = await invokeNotificationWorker(worker.default, {
    commentMention: {
      commentId: 'c1',
      commentUserId: '2',
      mentionedUserId,
    },
  });
  expect(actual).toBeFalsy();
});

it('should not add comment mention notification when you mentioned the parent comment author', async () => {
  const mentionedUserId = '2';
  await con.getRepository(Comment).save([
    {
      id: 'c2',
      postId: 'p1',
      userId: '1',
      content: 'sub comment',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
  ]);
  const worker = await import('../../src/workers/notifications/commentMention');
  const actual = await invokeNotificationWorker(worker.default, {
    commentMention: {
      commentId: 'c2',
      commentUserId: '1',
      mentionedUserId,
    },
  });
  expect(actual).toBeFalsy();
});

it('should not add comment mention notification when you mentioned someone in the same thread', async () => {
  const mentionedUserId = '3';
  await con.getRepository(Comment).save([
    {
      id: 'c2',
      postId: 'p1',
      userId: '1',
      content: 'sub comment',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c3',
      postId: 'p1',
      userId: '3',
      content: 'sub comment',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
  ]);
  const worker = await import('../../src/workers/notifications/commentMention');
  const actual = await invokeNotificationWorker(worker.default, {
    commentMention: {
      commentId: 'c2',
      commentUserId: '1',
      mentionedUserId,
    },
  });
  expect(actual).toBeFalsy();
});

describe('comment reply worker', () => {
  const prepareComments = async () =>
    con.getRepository(Comment).save([
      {
        id: 'c2',
        postId: 'p1',
        userId: '2',
        content: 'sub comment',
        createdAt: new Date(2020, 1, 6, 0, 0),
        parentId: 'c1',
      },
      {
        id: 'c3',
        postId: 'p1',
        userId: '1',
        content: 'sub comment2',
        createdAt: new Date(2020, 1, 6, 0, 0),
        parentId: 'c1',
      },
      {
        id: 'c4',
        postId: 'p1',
        userId: '3',
        content: 'sub comment3',
        createdAt: new Date(2020, 1, 6, 0, 0),
        parentId: 'c1',
      },
      {
        id: 'c5',
        postId: 'p1',
        userId: '4',
        content: 'sub comment4',
        createdAt: new Date(2020, 1, 6, 0, 0),
        parentId: 'c1',
      },
    ]);

  it('should add comment reply notification for main user', async () => {
    await prepareComments();
    const worker = await import('../../src/workers/notifications/commentReply');
    const actual = await invokeNotificationWorker(worker.default, {
      postId: 'p1',
      userId: '4',
      childCommentId: 'c5',
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('comment_reply');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationCommentContext).comment.id).toEqual('c5');
    expect((bundle.ctx as NotificationCommenterContext).commenter.id).toEqual(
      '4',
    );

    expect(actual[0].ctx.userIds).toIncludeSameMembers(['2']);
  });

  it('should add comment reply notification but ignore muted users', async () => {
    await prepareComments();
    await con.getRepository(NotificationPreferenceComment).save({
      userId: '2',
      commentId: 'c1',
      referenceId: 'c1',
      status: NotificationPreferenceStatus.Muted,
      notificationType: NotificationType.CommentReply,
    });
    const worker = await import('../../src/workers/notifications/commentReply');
    const actual = await invokeNotificationWorker(worker.default, {
      postId: 'p1',
      userId: '4',
      childCommentId: 'c5',
    });
    expect(actual.length).toEqual(1);
    const bundle = actual[0];
    expect(bundle.type).toEqual('comment_reply');
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationCommentContext).comment.id).toEqual('c5');
    expect((bundle.ctx as NotificationCommenterContext).commenter.id).toEqual(
      '4',
    );
    expect(actual[0].ctx.userIds).toEqual([]);
  });

  it('should not add comment reply notification to comment author on their reply', async () => {
    await con.getRepository(Comment).save([
      {
        id: 'c2',
        postId: 'p1',
        userId: '2',
        content: 'sub comment',
        createdAt: new Date(2020, 1, 6, 0, 0),
        parentId: 'c1',
      },
      {
        id: 'c3',
        postId: 'p1',
        userId: '1',
        content: 'sub comment2',
        createdAt: new Date(2020, 1, 6, 0, 0),
        parentId: 'c1',
      },
    ]);
    const worker = await import('../../src/workers/notifications/commentReply');
    const actual = await invokeNotificationWorker(worker.default, {
      postId: 'p1',
      userId: '1',
      childCommentId: 'c3',
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].ctx.userIds).toEqual(['2']);
  });
});

describe('comment upvote milestone', () => {
  it('should not add notification for author when not a member or blocked in the squad', async () => {
    const worker = await import(
      '../../src/workers/notifications/commentUpvoteMilestone'
    );
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    const repo = con.getRepository(ContentPreferenceSource);
    await con.getRepository(Comment).update({ id: 'c1' }, { upvotes: 3 });
    await con.getRepository(UserComment).save([
      {
        userId: '1',
        commentId: 'c1',
        vote: UserVote.Up,
      },
      { userId: '4', commentId: 'c1', vote: UserVote.Up },
    ]);
    const params = { userId: '1', sourceId: 'a' };
    await repo.update(params, {
      flags: updateFlagsStatement<ContentPreferenceSource>({
        role: SourceMemberRoles.Blocked,
      }),
    });
    const actual1 = await invokeNotificationWorker(worker.default, {
      userId: '1',
      commentId: 'c1',
    });
    expect(actual1).toBeFalsy();
    await repo.delete(params);
    const actual2 = await invokeNotificationWorker(worker.default, {
      userId: '1',
      commentId: 'c1',
    });
    expect(actual2).toBeFalsy();
  });

  it('should add notification for author', async () => {
    const worker = await import(
      '../../src/workers/notifications/commentUpvoteMilestone'
    );
    await con.getRepository(Comment).update({ id: 'c1' }, { upvotes: 3 });
    await con.getRepository(UserComment).save([
      {
        userId: '1',
        commentId: 'c1',
        vote: UserVote.Up,
      },
      { userId: '4', commentId: 'c1', vote: UserVote.Up },
    ]);
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      commentId: 'c1',
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('comment_upvote_milestone');
    expect((actual[0].ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((actual[0].ctx as NotificationPostContext).source.id).toEqual('a');
    expect((actual[0].ctx as NotificationCommentContext).comment.id).toEqual(
      'c1',
    );
    expect((actual[0].ctx as NotificationUpvotersContext).upvotes).toEqual(5);
    expect(
      (actual[0].ctx as NotificationUpvotersContext).upvoters.length,
    ).toEqual(2);
    expect(actual[0].ctx.userIds).toEqual(['2']);
  });

  it('should not add notification when the author upvoted', async () => {
    await con.getRepository(Comment).update({ id: 'c1' }, { upvotes: 5 });
    const worker = await import(
      '../../src/workers/notifications/commentUpvoteMilestone'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '2',
      commentId: 'c1',
    });
    expect(actual).toBeFalsy();
  });

  it('should not add notification if it is not milestone', async () => {
    await con.getRepository(Comment).update({ id: 'c1' }, { upvotes: 11 });
    const worker = await import(
      '../../src/workers/notifications/commentUpvoteMilestone'
    );
    const actual = await invokeNotificationWorker(worker.default, {
      userId: '1',
      commentId: 'c1',
    });
    expect(actual).toBeFalsy();
  });
});

describe('squad member joined', () => {
  const prepareSquad = async () => {
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    const source = await con.getRepository(Source).findOneBy({ id: 'a' });
    await createSquadWelcomePost(con, source as SquadSource, '1');
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'rt1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
    ]);
  };

  it('should add notification to squad admin', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadMemberJoined'
    );
    await prepareSquad();
    const actual = await invokeNotificationWorker(worker.default, {
      sourceMember: {
        sourceId: 'a',
        userId: '1',
        flags: {},
      },
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('squad_member_joined');
    expect(actual[0].ctx.userIds).toEqual(['2']);
    const ctx = actual[0].ctx as NotificationSourceContext &
      NotificationDoneByContext;
    expect(ctx.source.id).toEqual('a');
    expect(ctx.doneBy.id).toEqual('1');
  });

  it('should add notification to squad admin but exclude muted users', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadMemberJoined'
    );
    await prepareSquad();
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '3',
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'token',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '3',
    });
    await con.getRepository(NotificationPreferenceSource).save({
      userId: '3',
      sourceId: 'a',
      referenceId: 'a',
      status: NotificationPreferenceStatus.Muted,
      notificationType: NotificationType.SquadMemberJoined,
    });
    const actual = await invokeNotificationWorker(worker.default, {
      sourceMember: {
        sourceId: 'a',
        userId: '1',
        flags: {},
      },
    });
    expect(actual.length).toEqual(1);
    expect(actual[0].type).toEqual('squad_member_joined');
    expect(actual[0].ctx.userIds).toEqual(['2']);
    const ctx = actual[0].ctx as NotificationSourceContext &
      NotificationDoneByContext;
    expect(ctx.source.id).toEqual('a');
    expect(ctx.doneBy.id).toEqual('1');
  });

  it('should not add notification when admin joins', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadMemberJoined'
    );
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'rt1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
    ]);
    const actual = await invokeNotificationWorker(worker.default, {
      sourceMember: {
        sourceId: 'a',
        userId: '2',
        flags: {},
      },
    });
    expect(actual).toBeFalsy();
  });

  const testJoinSquadAction = async (
    type: UserActionType,
    role: SourceMemberRoles = SourceMemberRoles.Admin,
  ) => {
    const worker = await import(
      '../../src/workers/notifications/squadMemberJoined'
    );
    const params = { userId: '2', type };
    const repo = con.getRepository(UserAction);
    const exists = await repo.findOneBy(params);
    expect(exists).toBeFalsy();
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '2',
        flags: {
          role,
          referralToken: 'rt1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
    ]);
    await invokeNotificationWorker(worker.default, {
      sourceMember: {
        sourceId: 'a',
        userId: '2',
        flags: {
          role,
        },
      },
    });

    const action = await repo.findOneBy(params);
    expect(action).toBeTruthy();
    expect(action.type).toEqual(type);

    await invokeNotificationWorker(worker.default, {
      sourceMember: {
        sourceId: 'a',
        userId: '2',
        flags: {},
      },
    });
    const createSquad = await repo.findOneBy(params);
    expect(action.completedAt).toEqual(createSquad.completedAt);
  };

  it('should insert or ignore record for action type join_squad when user is a member', async () =>
    testJoinSquadAction(UserActionType.JoinSquad, SourceMemberRoles.Member));

  it('should insert or ignore record for action type join_squad when user is a moderator', async () =>
    testJoinSquadAction(UserActionType.JoinSquad, SourceMemberRoles.Moderator));

  it('should not add notification if member does not exist', async () => {
    const worker = await import(
      '../../src/workers/notifications/squadMemberJoined'
    );
    await prepareSquad();
    await con.getRepository(User).delete({ id: '1' });
    const actual = await invokeNotificationWorker(worker.default, {
      sourceMember: {
        sourceId: 'a',
        userId: '1',
        flags: {},
      },
    });
    expect(actual).toBeUndefined();
  });
});

it('should add squad reply notification', async () => {
  await con
    .getRepository(Source)
    .update({ id: 'a' }, { type: SourceType.Squad });
  await con.getRepository(Comment).save([
    {
      id: 'c2',
      postId: 'p1',
      userId: '2',
      content: 'sub comment',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c3',
      postId: 'p1',
      userId: '1',
      content: 'sub comment2',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c4',
      postId: 'p1',
      userId: '3',
      content: 'sub comment3',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c5',
      postId: 'p1',
      userId: '4',
      content: 'sub comment4',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
  ]);
  const worker = await import('../../src/workers/notifications/commentReply');
  const actual = await invokeNotificationWorker(worker.default, {
    postId: 'p1',
    userId: '4',
    childCommentId: 'c5',
  });
  expect(actual.length).toEqual(1);
  const bundle = actual[0];
  expect(bundle.type).toEqual('squad_reply');
  expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
  expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
  expect((bundle.ctx as NotificationCommentContext).comment.id).toEqual('c5');
  expect((bundle.ctx as NotificationCommenterContext).commenter.id).toEqual(
    '4',
  );
  expect(actual[0].ctx.userIds).toIncludeSameMembers(['2']);
});

it('users should not get a reply notification if they commented in the same thread', async () => {
  await con
    .getRepository(Source)
    .update({ id: 'a' }, { type: SourceType.Squad });

  await con.getRepository(Comment).save([
    {
      id: 'c2',
      postId: 'p1',
      userId: '2',
      content: 'sub comment',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c3',
      postId: 'p1',
      userId: '1',
      content: 'sub comment2',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c4',
      postId: 'p1',
      userId: '3',
      content: 'sub comment3',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
    {
      id: 'c5',
      postId: 'p1',
      userId: '4',
      content: 'sub comment4',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
  ]);

  // add new comment for testing notification after first comment
  // should notify users who commented on the first comment
  // not userId 3 who is the one who is writing
  await con.getRepository(Comment).save([
    {
      id: 'c6',
      postId: 'p1',
      userId: '3',
      content: 'sub comment5',
      createdAt: new Date(2020, 1, 6, 0, 0),
      parentId: 'c1',
    },
  ]);

  const worker = await import('../../src/workers/notifications/commentReply');
  const actual = await invokeNotificationWorker(worker.default, {
    postId: 'p1',
    userId: '3',
    childCommentId: 'c6',
  });

  expect(actual.length).toEqual(1);
  const bundle2 = actual[0];
  expect(bundle2.type).toEqual('squad_reply');
  expect((bundle2.ctx as NotificationPostContext).post.id).toEqual('p1');
  expect((bundle2.ctx as NotificationPostContext).source.id).toEqual('a');
  expect((bundle2.ctx as NotificationCommentContext).comment.id).toEqual('c6');
  expect((bundle2.ctx as NotificationCommenterContext).commenter.id).toEqual(
    '3',
  );
  expect(actual[0].ctx.userIds).toEqual(['2']);
});

describe('user post added', () => {
  beforeEach(async () => {
    await saveFixtures(
      con,
      Feed,
      usersFixture.map((item) => ({
        id: item.id,
        userId: item.id,
      })),
    );
  });

  it('should add notification for author', async () => {
    const { postAddedUserNotification: worker } = await import(
      '../../src/workers/notifications/postAddedUserNotification'
    );
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    await con.getRepository(ContentPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
    ]);
    const actual = await invokeNotificationWorker(worker, {
      post: postsFixture[0],
    });
    expect(actual!.length).toEqual(1);
    const bundle = actual![0];
    expect(bundle.type).toEqual(NotificationType.UserPostAdded);
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationUserContext).user.id).toEqual('1');
    expect(bundle.ctx.userIds).toIncludeSameMembers(['2', '3']);
  });

  it('should add notification for scout', async () => {
    const { postAddedUserNotification: worker } = await import(
      '../../src/workers/notifications/postAddedUserNotification'
    );
    await con.getRepository(Post).update({ id: 'p1' }, { scoutId: '1' });
    await con.getRepository(ContentPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
    ]);
    const actual = await invokeNotificationWorker(worker, {
      post: postsFixture[0],
    });
    expect(actual!.length).toEqual(1);
    const bundle = actual![0];
    expect(bundle.type).toEqual(NotificationType.UserPostAdded);
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationUserContext).user.id).toEqual('1');
    expect(bundle.ctx.userIds).toIncludeSameMembers(['2', '3']);
  });

  it('should not add notification for user that are only following', async () => {
    const { postAddedUserNotification: worker } = await import(
      '../../src/workers/notifications/postAddedUserNotification'
    );
    await con.getRepository(Post).update({ id: 'p1' }, { scoutId: '1' });
    await con.getRepository(ContentPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Follow,
      },
    ]);
    const actual = await invokeNotificationWorker(worker, {
      post: postsFixture[0],
    });
    expect(actual!.length).toEqual(1);
    const bundle = actual![0];
    expect(bundle.type).toEqual(NotificationType.UserPostAdded);
    expect((bundle.ctx as NotificationPostContext).post.id).toEqual('p1');
    expect((bundle.ctx as NotificationPostContext).source.id).toEqual('a');
    expect((bundle.ctx as NotificationUserContext).user.id).toEqual('1');
    expect(bundle.ctx.userIds).toIncludeSameMembers(['2']);
  });

  it('should not add notification for private post', async () => {
    const { postAddedUserNotification: worker } = await import(
      '../../src/workers/notifications/postAddedUserNotification'
    );
    const privatePost = await con.getRepository(Post).save({
      ...postsFixture[0],
      id: 'p1-upa',
      shortId: 'sp1-upa',
      private: true,
      url: 'https://example.com/p/sp1-upa',
      canonicalUrl: 'https://example.com/p/sp1-upa',
      authorId: '1',
    });
    await con.getRepository(ContentPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
    ]);
    const actual = await invokeNotificationWorker(worker, {
      post: privatePost,
    });
    expect(actual).toBeUndefined();
  });

  it('should not add notification for user that muted', async () => {
    const { postAddedUserNotification: worker } = await import(
      '../../src/workers/notifications/postAddedUserNotification'
    );
    await con.getRepository(Post).update({ id: 'p1' }, { scoutId: '1' });
    await con.getRepository(ContentPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
    ]);
    await con.getRepository(NotificationPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        notificationType: NotificationType.UserPostAdded,
        status: NotificationPreferenceStatus.Muted,
      },
    ]);
    const actual = await invokeNotificationWorker(worker, {
      post: postsFixture[0],
    });
    expect(actual!.length).toEqual(1);
    const bundle = actual![0];
    expect(bundle.ctx.userIds).toIncludeSameMembers(['3']);
  });

  it('should only query subscriptions for user post added notification type', async () => {
    const { postAddedUserNotification: worker } = await import(
      '../../src/workers/notifications/postAddedUserNotification'
    );
    await con.getRepository(Post).update({ id: 'p1' }, { scoutId: '1' });
    await con.getRepository(ContentPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
      {
        userId: '4',
        feedId: '4',
        referenceId: '1',
        referenceUserId: '1',
        status: ContentPreferenceStatus.Subscribed,
      },
    ]);
    await con.getRepository(NotificationPreferenceUser).save([
      {
        userId: '2',
        feedId: '2',
        referenceId: '1',
        referenceUserId: '1',
        notificationType: NotificationType.UserPostAdded,
        status: NotificationPreferenceStatus.Muted,
      },
    ]);
    await con.getRepository(NotificationPreferenceSource).save([
      {
        userId: '3',
        feedId: '3',
        referenceId: 'b',
        sourceId: 'b',
        notificationType: NotificationType.SourcePostAdded,
        status: NotificationPreferenceStatus.Subscribed,
      },
      {
        userId: '3',
        feedId: '3',
        referenceId: 'a',
        sourceId: 'a',
        notificationType: NotificationType.SourcePostAdded,
        status: NotificationPreferenceStatus.Subscribed,
      },
      {
        userId: '4',
        feedId: '4',
        referenceId: 'a',
        sourceId: 'a',
        notificationType: NotificationType.SourcePostAdded,
        status: NotificationPreferenceStatus.Subscribed,
      },
    ]);
    const actual = await invokeNotificationWorker(worker, {
      post: postsFixture[0],
    });
    expect(actual!.length).toEqual(1);
    const bundle = actual![0];
    expect(bundle.ctx.userIds).toHaveLength(2);
    expect(bundle.ctx.userIds).toIncludeSameMembers(['3', '4']);
  });
});
