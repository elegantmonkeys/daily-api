import { generateTypedNotificationWorker } from './worker';
import { SourceMemberRoles } from '../../roles';
import { NotificationType } from '../../notifications/common';
import { NotificationPostModerationContext } from '../../notifications';
import { SourcePostModerationStatus } from '../../entity/SourcePostModeration';
import { getPostModerationContext } from './utils';
import { logger } from '../../logger';
import { TypeORMQueryFailedError } from '../../errors';
import { ContentPreferenceSource } from '../../entity/contentPreference/ContentPreferenceSource';

const worker =
  generateTypedNotificationWorker<'api.v1.source-post-moderation-submitted'>({
    subscription: 'api.source-post-moderation-submitted-notification',
    handler: async ({ post }, con) => {
      if (post.status !== SourcePostModerationStatus.Pending) {
        return;
      }

      try {
        const moderationCtx = await getPostModerationContext(con, post);
        const mods = await con
          .getRepository(ContentPreferenceSource)
          .createQueryBuilder()
          .select('"userId"')
          .where('"referenceId" = :sourceId', { sourceId: post.sourceId })
          .andWhere(`flags->>'role' IN (:...roles)`, {
            roles: [SourceMemberRoles.Admin, SourceMemberRoles.Moderator],
          })
          .getRawMany<Pick<ContentPreferenceSource, 'userId'>>();

        const ctx: NotificationPostModerationContext = {
          ...moderationCtx,
          userIds: mods.map((m) => m.userId),
        };

        return [{ type: NotificationType.SourcePostSubmitted, ctx }];
      } catch (err) {
        const error = err as TypeORMQueryFailedError;
        if (error?.name !== 'EntityNotFoundError') {
          logger.error(
            { err, post },
            'failed sending notification for squad post moderation submitted',
          );
        }
      }
    },
  });

export default worker;
