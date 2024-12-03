import { ghostUser } from '../common';
import { TypedWorker } from './worker';
import { addNewSourceMember, removeSourceMember } from '../schema/sources';
import { SourceMemberRoles } from '../roles';
import { User } from '../entity';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { Not } from 'typeorm';
import { ContentPreferenceStatus } from '../entity/contentPreference/types';

const PLUS_MEMBER_SQUAD_ID = '05862288-bace-4723-9218-d30fab6ae96d';
const worker: TypedWorker<'user-updated'> = {
  subscription: 'api.user-updated-plus-subscribed',
  handler: async (message, con, log) => {
    const {
      data: { newProfile: user, user: oldUser },
    } = message;

    const beforeFlags = JSON.parse(
      (oldUser.subscriptionFlags as string) || '{}',
    ) as User['subscriptionFlags'];
    const afterFlags = JSON.parse(
      (user.subscriptionFlags as string) || '{}',
    ) as User['subscriptionFlags'];

    if (user.id === ghostUser.id || !user.infoConfirmed) {
      return;
    }

    if (afterFlags?.subscriptionId === beforeFlags?.subscriptionId) {
      return;
    }

    if (afterFlags?.subscriptionId === '' || !afterFlags?.subscriptionId) {
      // Stopped being plus member remove them
      await removeSourceMember({
        con,
        userId: user.id,
        sourceId: PLUS_MEMBER_SQUAD_ID,
      });
      log.info({ userId: user.id }, 'removed user from plus member squad');
    } else {
      // Started being plus member add them
      const check = await con.getRepository(ContentPreferenceSource).findOne({
        where: {
          userId: user.id,
          referenceId: PLUS_MEMBER_SQUAD_ID,
          status: Not(ContentPreferenceStatus.Blocked),
        },
      });
      if (check) {
        log.info({ userId: user.id }, 'user was already in plus member squad');
        return;
      }
      const member = {
        sourceId: PLUS_MEMBER_SQUAD_ID,
        userId: user.id,
        role: SourceMemberRoles.Member,
      };
      await addNewSourceMember(con, member);
      log.info({ userId: user.id }, 'added user to plus member squad');
    }
  },
};

export default worker;
