import { NotificationType } from '../../notifications/common';
import { generateTypedNotificationWorker } from './worker';
import { NotificationSourceContext } from '../../notifications';
import { SourceMemberRoles } from '../../roles';
import { ContentPreferenceSource } from '../../entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../../entity/contentPreference/types';

const toNotify = [SourceMemberRoles.Admin, SourceMemberRoles.Moderator];

const worker = generateTypedNotificationWorker<'api.v1.squad-featured-updated'>(
  {
    subscription: 'api.squad-featured-updated-notification',
    handler: async ({ squad }, con) => {
      if (!squad.flags.featured) {
        return undefined;
      }

      const users = await con
        .getRepository(ContentPreferenceSource)
        .createQueryBuilder()
        .select('"userId"')
        .where('"referenceId" = :sourceId', { sourceId: squad.id })
        .andWhere(`flags->>'role' IN (:...roles)`, { roles: toNotify })
        .andWhere(`status != :status`, {
          status: ContentPreferenceStatus.Blocked,
        })
        .getRawMany<Pick<ContentPreferenceSource, 'userId'>>();

      if (!users.length) {
        return undefined;
      }

      const ctx: NotificationSourceContext = {
        userIds: users.map((u) => u.userId),
        source: squad,
      };

      return [{ type: NotificationType.SquadFeatured, ctx }];
    },
  },
);

export default worker;
