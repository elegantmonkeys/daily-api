import { generateTypedNotificationWorker } from './worker';
import { SourceMember } from '../../entity';
import { In } from 'typeorm';
import { SourceMemberRoles } from '../../roles';
import { NotificationType } from '../../notifications/common';
import { NotificationPostModerationContext } from '../../notifications';
import { SquadPostModerationStatus } from '../../entity/SquadPostModeration';
import { getPostModerationContext } from './utils';
import { logger } from '../../logger';
import { TypeORMQueryFailedError } from '../../errors';

const worker =
  generateTypedNotificationWorker<'api.v1.source-post-moderation-submitted'>({
    subscription: 'api.v1.source-post-moderation-submitted-notification',
    handler: async ({ post }, con) => {
      if (post.status !== SquadPostModerationStatus.Pending) {
        return;
      }

      try {
        const moderationCtx = await getPostModerationContext(con, post);
        const mods = await con.getRepository(SourceMember).find({
          select: ['userId'],
          where: {
            sourceId: post.sourceId,
            role: In([SourceMemberRoles.Admin, SourceMemberRoles.Moderator]),
          },
        });

        const ctx: NotificationPostModerationContext = {
          ...moderationCtx,
          userIds: mods.map((m) => m.userId),
        };

        return [{ type: NotificationType.SquadPostSubmitted, ctx }];
      } catch (err) {
        const error = err as TypeORMQueryFailedError;
        if (error?.name !== 'EntityNotFoundError') {
          logger.error(
            'failed sending notification for squad post moderation submitted',
            err,
          );
        }
      }
    },
  });

export default worker;
