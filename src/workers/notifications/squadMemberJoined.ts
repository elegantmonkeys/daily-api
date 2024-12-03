import { messageToJson } from '../worker';
import { NotificationType } from '../../notifications/common';
import { NotificationWorker } from './worker';
import { ChangeObject } from '../../types';
import {
  Source,
  SourceType,
  User,
  UserActionType,
  WelcomePost,
} from '../../entity';
import { SourceMemberRoles } from '../../roles';
import { insertOrIgnoreAction } from '../../schema/actions';
import { getSubscribedMembers } from './utils';
import { ContentPreferenceSource } from '../../entity/contentPreference/ContentPreferenceSource';

interface Data {
  sourceMember: ChangeObject<ContentPreferenceSource>;
}

const worker: NotificationWorker = {
  subscription: 'api.member-joined-source-notification',
  handler: async (message, con, logger) => {
    const { sourceMember: member }: Data = messageToJson(message);
    const logDetails = { member, messageId: message.messageId };
    const admins = await getSubscribedMembers(
      con,
      NotificationType.SquadMemberJoined,
      member.sourceId,
      (qb) =>
        qb
          .andWhere(`${qb.alias}."userId" NOT IN (:...users)`, {
            users: [member.userId],
          })
          .andWhere(`${qb.alias}."referenceId" = :sourceId`, {
            sourceId: member.sourceId,
          })
          .andWhere(` ${qb.alias}.flags->>'role' = :role`, {
            role: SourceMemberRoles.Admin,
          }),
    );

    const doneBy = await con
      .getRepository(User)
      .findOneBy({ id: member.userId });

    if (!doneBy) {
      logger.info(logDetails, 'doneBy user does not exist');

      return;
    }

    if (member.flags.role !== SourceMemberRoles.Admin) {
      await insertOrIgnoreAction(con, member.userId, UserActionType.JoinSquad);
    }

    if (!admins?.length) {
      return;
    }
    const [source, post] = await Promise.all([
      con.getRepository(Source).findOneBy({ id: member.sourceId }),
      con.getRepository(WelcomePost).findOneBy({ sourceId: member.sourceId }),
    ]);

    if (!source) {
      logger.info(logDetails, 'source does not exist');

      return;
    }

    if (!post || source.type !== SourceType.Squad) {
      return;
    }

    return [
      {
        type: NotificationType.SquadMemberJoined,
        ctx: {
          userIds: admins.map(({ userId }) => userId),
          post,
          source,
          doneBy,
        },
      },
    ];
  },
};

export default worker;
