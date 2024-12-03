import { NotificationHandlerReturn } from './worker';
import {
  Comment,
  NotificationPreference,
  NotificationPreferencePost,
  Post,
  PostType,
  SharePost,
  Source,
  SourceType,
  User,
  UserActionType,
} from '../../entity';
import {
  NotificationCommenterContext,
  NotificationPostContext,
  NotificationPostModerationContext,
} from '../../notifications';
import {
  notificationPreferenceMap,
  NotificationPreferenceStatus,
  NotificationType,
} from '../../notifications/common';
import { DataSource, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { SourceMemberRoles } from '../../roles';
import { insertOrIgnoreAction } from '../../schema/actions';
import { SourcePostModeration } from '../../entity/SourcePostModeration';
import { ChangeObject } from '../../types';
import { ContentPreferenceSource } from '../../entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../../entity/contentPreference/types';

export const uniquePostOwners = (
  post: Pick<Post, 'scoutId' | 'authorId'>,
  ignoreIds: string[] = [],
): string[] =>
  [...new Set([post.scoutId, post.authorId])].filter(
    (userId) => userId && !ignoreIds.includes(userId),
  ) as string[];

type GetSubscribedMembersWhereBuilder = (
  qb: SelectQueryBuilder<ContentPreferenceSource>,
) => SelectQueryBuilder<ContentPreferenceSource>;

export const getSubscribedMembers = (
  con: DataSource,
  type: NotificationType,
  referenceId: string,
  where: GetSubscribedMembersWhereBuilder,
) => {
  const builder = con
    .getRepository(ContentPreferenceSource)
    .createQueryBuilder('cps');
  const memberQuery = where(builder.select('"userId"'));
  const muteQuery = builder
    .subQuery()
    .select('np."userId"')
    .from(NotificationPreference, 'np')
    .where(`"np"."userId" = "${memberQuery.alias}"."userId"`)
    .andWhere({
      notificationType: type,
      referenceId,
      type: notificationPreferenceMap[type],
      status: NotificationPreferenceStatus.Muted,
    });

  return memberQuery
    .andWhere(`EXISTS(${muteQuery.getQuery()}) IS FALSE`)
    .getRawMany<ContentPreferenceSource>();
};

export const buildPostContext = async (
  con: DataSource,
  postId: string,
): Promise<Omit<NotificationPostContext, 'userIds'> | null> => {
  const post = await con
    .getRepository(Post)
    .findOne({ where: { id: postId }, relations: ['source'] });
  let sharedPost: Post | null = null;
  if (post) {
    if (post.type === PostType.Share) {
      sharedPost = await con
        .getRepository(Post)
        .findOneBy({ id: (post as SharePost).sharedPostId });
    }
    return {
      post,
      source: await post.source,
      sharedPost,
    };
  }
  return null;
};

export async function articleNewCommentHandler(
  con: DataSource,
  commentId: string,
): Promise<NotificationHandlerReturn> {
  const repo = con.getRepository(Comment);
  const comment = await repo.findOne({
    where: { id: commentId },
    relations: ['user'],
  });
  if (!comment) {
    return;
  }
  if (comment.flags?.vordr) {
    return;
  }
  const postCtx = await buildPostContext(con, comment.postId);
  if (!postCtx) {
    return;
  }

  const { post, source } = postCtx;
  const excludedUsers = [comment.userId];
  const isReply = !!comment.parentId;

  if (source.type === SourceType.Squad) {
    await insertOrIgnoreAction(
      con,
      comment.userId,
      UserActionType.SquadFirstComment,
    );
  }

  if (isReply && (post.authorId || post.scoutId)) {
    const ids = [...new Set([post.authorId, post.scoutId])];
    const threadFollower = await repo
      .createQueryBuilder()
      .select('"userId"')
      .where(`(id = :id OR "parentId" = :id)`, { id: comment.parentId })
      .andWhere({ userId: In(ids) })
      .groupBy('"userId"')
      .getRawMany();

    if (threadFollower.length) {
      threadFollower.forEach(({ userId }) => excludedUsers.push(userId));
    }
  }

  const excluded = [...new Set(excludedUsers)];
  // Get unique user id which are not the author of the comment
  const users = uniquePostOwners(post, excluded);
  if (!users.length) {
    return;
  }

  const commenter = await comment.user;
  const ctx: Omit<NotificationCommenterContext, 'userIds'> = {
    ...postCtx,
    commenter,
    comment,
  };
  const type =
    ctx.source.type === SourceType.Squad
      ? NotificationType.SquadNewComment
      : NotificationType.ArticleNewComment;

  if (source.type === SourceType.Squad) {
    const members = await getSubscribedMembers(con, type, post.id, (qb) =>
      qb
        .andWhere(`${qb.alias}."userId" IN (:...users)`, {
          users,
        })
        .andWhere(`${qb.alias}."referenceId" = :sourceId`, {
          sourceId: source.id,
        })
        .andWhere(`status != :status`, {
          status: ContentPreferenceStatus.Blocked,
        })
        .andWhere(` ${qb.alias}.flags->>'role' != :role`, {
          role: SourceMemberRoles.Blocked,
        }),
    );

    if (!members.length) {
      return;
    }

    return [
      {
        type,
        ctx: { ...ctx, userIds: members.map(({ userId }) => userId) },
      },
    ];
  }

  const muted = await con.getRepository(NotificationPreferencePost).findBy({
    userId: In(users),
    referenceId: post.id,
    notificationType: type,
    type: notificationPreferenceMap[type],
    status: NotificationPreferenceStatus.Muted,
  });

  return [
    {
      type,
      ctx: {
        ...ctx,
        userIds: users.filter((id) =>
          muted.every(({ userId }) => userId !== id),
        ),
      },
    },
  ];
}

export const UPVOTE_TITLES = {
  1: 'Congrats! You just <span class="text-theme-color-avocado">earned 1 upvote 🎉</span>',
  3: 'Wow! You <span class="text-theme-color-avocado">earned 3 upvotes ✨</span>',
  5: 'You rock! You <span class="text-theme-color-avocado">earned 5 upvotes 🎸</span>',
  10: 'Well done! You <span class="text-theme-color-avocado">earned 10 upvotes 🙌</span>',
  20: 'Brilliant! You <span class="text-theme-color-avocado">earned 20 upvotes 🥳</span>',
  50: 'Good job! You <span class="text-theme-color-avocado">earned 50 upvotes 🚴‍♀️</span>',
  100: 'Excellent! You <span class="text-theme-color-avocado">earned 100 upvotes ⚡️</span>',
  200: 'Way to go! You <span class="text-theme-color-avocado">earned 200 upvotes 🚀</span>',
  500: 'Clever! You <span class="text-theme-color-avocado">earned 500 upvotes 🦸‍</span>',
  1000: 'Superb! You <span class="text-theme-color-avocado">earned 1,000 upvotes 😱</span>',
  2000: 'Legendary! You <span class="text-theme-color-avocado">earned 2,000 upvotes 💥</span>',
  5000: 'Unbelievable! You <span class="text-theme-color-avocado">earned 5,000 upvotes 😳</span>',
  10000: `We're speechless! You <span class="text-theme-color-avocado">earned 10,000 upvotes 🙉</span>`,
};
export const UPVOTE_MILESTONES = Object.keys(UPVOTE_TITLES);

export const getPostModerationContext = async (
  con: DataSource | EntityManager,
  post: ChangeObject<SourcePostModeration>,
): Promise<Omit<NotificationPostModerationContext, 'userIds'>> => {
  const [user, source] = await Promise.all([
    con.getRepository(User).findOneOrFail({ where: { id: post.createdById } }),
    con.getRepository(Source).findOneOrFail({ where: { id: post.sourceId } }),
  ]);

  return { post, user, source };
};
