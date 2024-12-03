import { messageToJson } from '../worker';
import {
  NotificationPreferenceSource,
  Post,
  PostMention,
  PostType,
  SourceType,
  User,
  UserAction,
  UserActionType,
} from '../../entity';
import {
  NotificationDoneByContext,
  NotificationPostContext,
  NotificationSourceContext,
} from '../../notifications';
import {
  NotificationPreferenceStatus,
  NotificationType,
} from '../../notifications/common';
import { NotificationHandlerReturn, NotificationWorker } from './worker';
import { ChangeObject } from '../../types';
import { buildPostContext, getSubscribedMembers } from './utils';
import { SourceMemberRoles } from '../../roles';
import { insertOrIgnoreAction } from '../../schema/actions';
import { ContentPreferenceStatus } from '../../entity/contentPreference/types';

interface Data {
  post: ChangeObject<Post>;
}

const worker: NotificationWorker = {
  subscription: 'api.post-added-notification-v2',
  handler: async (message, con) => {
    const data: Data = messageToJson(message);
    const baseCtx = await buildPostContext(con, data.post.id);
    if (!baseCtx) {
      return;
    }
    const { post, source } = baseCtx;

    if (post.type === PostType.Welcome) {
      return;
    }

    if (post.flags?.vordr) {
      return;
    }

    const notifs: NotificationHandlerReturn = [];
    // community_picks_succeeded notification
    if (post.scoutId) {
      const ctx: NotificationPostContext = {
        ...baseCtx,
        userIds: [post.scoutId],
      };
      notifs.push({ type: NotificationType.CommunityPicksSucceeded, ctx });
    }

    if (source) {
      // article_picked notification
      if (source.type === SourceType.Machine) {
        if (post.authorId && !post.private) {
          const ctx: NotificationPostContext = {
            ...baseCtx,
            userIds: [post.authorId],
          };
          notifs.push({ type: NotificationType.ArticlePicked, ctx });
        }
      }
      if (source.type === SourceType.Squad && post.authorId) {
        // squad_post_added notification
        const doneBy = await con
          .getRepository(User)
          .findOneBy({ id: post.authorId });
        // Get mentioned users and exclude them
        const mentions = await con.getRepository(PostMention).find({
          select: { mentionedUserId: true },
          where: { postId: post.id },
        });
        const members = await getSubscribedMembers(
          con,
          NotificationType.SquadPostAdded,
          source.id,
          (qb) =>
            qb
              .andWhere(`${qb.alias}."userId" NOT IN (:...users)`, {
                users: [
                  post.authorId,
                  ...mentions.flatMap(({ mentionedUserId }) => mentionedUserId),
                ],
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
        if (members.length) {
          notifs.push({
            type: NotificationType.SquadPostAdded,
            ctx: {
              ...baseCtx,
              doneBy,
              userIds: members.map(({ userId }) => userId),
            } as NotificationPostContext & Partial<NotificationDoneByContext>,
          });
        }

        const hasPostShared = await con.getRepository(UserAction).findOneBy({
          userId: post.authorId,
          type: UserActionType.SquadFirstPost,
        });
        if (!hasPostShared) {
          await insertOrIgnoreAction(
            con,
            post.authorId,
            UserActionType.SquadFirstPost,
          );
          const subscribed = await con.getRepository(UserAction).findOneBy({
            userId: post.authorId,
            type: UserActionType.EnableNotification,
          });

          if (!subscribed) {
            notifs.push({
              type: NotificationType.SquadSubscribeToNotification,
              ctx: { ...baseCtx, userIds: [post.authorId] },
            });
          }
        }
      }

      if (source.type === SourceType.Machine) {
        const members = await con
          .getRepository(NotificationPreferenceSource)
          .findBy({
            notificationType: NotificationType.SourcePostAdded,
            referenceId: source.id,
            status: NotificationPreferenceStatus.Subscribed,
          });

        if (members.length) {
          notifs.push({
            type: NotificationType.SourcePostAdded,
            ctx: {
              ...baseCtx,
              userIds: members.map(({ userId }) => userId),
            } as NotificationSourceContext & NotificationPostContext,
          });
        }
      }
    }
    return notifs;
  },
};

export default worker;
