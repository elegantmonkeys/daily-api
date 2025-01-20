import { NotificationType } from '../../notifications/common';
import { generateTypedNotificationWorker } from './worker';
import { NotificationGiftPlusContext } from '../../notifications';
import { SquadSource, User, UserSubscriptionFlags } from '../../entity';
import { isGiftedPlus, isPlusMember } from '../../paddle';
import { queryReadReplica } from '../../common/queryReadReplica';
import { PLUS_MEMBER_SQUAD_ID } from '../userUpdatedPlusSubscriptionSquad';

const worker = generateTypedNotificationWorker<'user-updated'>({
  subscription: 'api.user-gifted-plus-notification',
  handler: async ({ user, newProfile: recipient }, con) => {
    const { id: userId } = user;

    const beforeSubscriptionFlags: Partial<UserSubscriptionFlags> = JSON.parse(
      (user.subscriptionFlags as string) || '{}',
    );
    const afterSubscriptionFlags: Partial<UserSubscriptionFlags> = JSON.parse(
      (recipient.subscriptionFlags as string) || '{}',
    );

    if (
      isPlusMember(beforeSubscriptionFlags?.cycle) ||
      !isGiftedPlus(afterSubscriptionFlags) ||
      !afterSubscriptionFlags?.gifterId
    ) {
      return;
    }

    const [gifter, squad] = await queryReadReplica(con, ({ queryRunner }) => {
      return Promise.all([
        queryRunner.manager.getRepository(User).findOneOrFail({
          where: { id: afterSubscriptionFlags.gifterId },
        }),
        queryRunner.manager.getRepository(SquadSource).findOneOrFail({
          where: { id: PLUS_MEMBER_SQUAD_ID },
        }),
      ]);
    });

    const ctx: NotificationGiftPlusContext = {
      userIds: [userId, gifter.id],
      gifter,
      recipient,
      subscriptionFlags: afterSubscriptionFlags,
      squad,
    };

    return [{ type: NotificationType.UserGiftedPlus, ctx }];
  },
});

export default worker;
