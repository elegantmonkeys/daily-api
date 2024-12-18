import { Cron } from './cron';
import {
  User,
  UserPersonalizedDigest,
  UserPersonalizedDigestSendType,
} from '../entity';
import { In } from 'typeorm';
import { blockingBatchRunner, callWithRetryDefault } from '../common/async';
import { setTimeout } from 'node:timers/promises';
import { cioV2, generateIdentifyObject } from '../cio';
import { updateFlagsStatement } from '../common';
import { getUsersActiveState } from '../common/googleCloud';

const ITEMS_PER_DESTROY = 4000;
const ITEMS_PER_IDENTIFY = 250;

const cron: Cron = {
  name: 'validate-active-users',
  handler: async (con) => {
    const { reactivateUsers, inactiveUsers, downgradeUsers } =
      await getUsersActiveState();

    // reactivated users: add to CIO
    await blockingBatchRunner({
      data: reactivateUsers,
      runner: async (batch) => {
        const validReactivateUsers = await con.getRepository(User).find({
          select: ['id'],
          where: { id: In(batch), cioRegistered: false },
        });

        if (validReactivateUsers.length === 0) {
          return true;
        }

        await blockingBatchRunner({
          batchLimit: ITEMS_PER_IDENTIFY,
          data: validReactivateUsers.map(({ id }) => id),
          runner: async (ids) => {
            const users = await con
              .getRepository(User)
              .find({ where: { id: In(ids) } });

            const data = await Promise.all(
              users.map((user) =>
                generateIdentifyObject(con, JSON.parse(JSON.stringify(user))),
              ),
            );

            await callWithRetryDefault(() =>
              cioV2.request.post('/users', { batch: data }),
            );

            await con
              .getRepository(User)
              .update({ id: In(ids) }, { cioRegistered: true });

            await setTimeout(20); // wait for a bit to avoid rate limiting
          },
        });
      },
    });

    // inactive for 12 weeks: remove from CIO
    await blockingBatchRunner({
      data: inactiveUsers,
      runner: async (batch) => {
        const validInactiveUsers = await con.getRepository(User).find({
          select: ['id'],
          where: { id: In(batch), cioRegistered: true },
        });

        if (validInactiveUsers.length === 0) {
          return true;
        }

        await blockingBatchRunner({
          batchLimit: ITEMS_PER_DESTROY,
          data: validInactiveUsers.map(({ id }) => id),
          runner: async (ids) => {
            const data = ids.map((id) => ({
              action: 'destroy',
              type: 'person',
              identifiers: { id },
            }));

            await callWithRetryDefault(() =>
              cioV2.request.post('/users', { batch: data }),
            );

            await con.getRepository(User).update(
              { id: In(ids) },
              {
                cioRegistered: false,
                acceptedMarketing: false,
                followingEmail: false,
                notificationEmail: false,
              },
            );

            await setTimeout(20); // wait for a bit to avoid rate limiting
          },
        });
      },
    });

    // inactive for 6 weeks: downgrade from daily to weekly digest
    await blockingBatchRunner({
      data: downgradeUsers,
      runner: async (current) => {
        const validDowngradeUsers = await con
          .getRepository(User)
          .createQueryBuilder('u')
          .select('id')
          .innerJoin(UserPersonalizedDigest, 'upd', 'u.id = upd."userId"')
          .where('u.id IN (:...ids)', { ids: current })
          .andWhere(`upd.flags->>'sendType' = 'daily'`)
          .getRawMany<Pick<User, 'id'>>();

        // set digest to weekly on Wednesday 9am
        await con.getRepository(UserPersonalizedDigest).update(
          { userId: In(validDowngradeUsers.map(({ id }) => id)) },
          {
            preferredDay: 3,
            preferredHour: 9,
            flags: updateFlagsStatement({
              sendType: UserPersonalizedDigestSendType.weekly,
            }),
          },
        );
      },
    });
  },
};

export default cron;
