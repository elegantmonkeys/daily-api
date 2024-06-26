import { Cron } from './cron';
import { User, UserStreak } from '../entity';
import { checkUserStreak } from '../common';
import { opentelemetry } from '../telemetry/opentelemetry';

const cron: Cron = {
  name: 'update-current-streak',
  handler: async (con, logger) => {
    try {
      const streakCounter = opentelemetry.metrics
        .getMeter('api-bg')
        .createCounter('streak_update', {
          description: 'How many streaks get updated',
        });
      await con.transaction(async (entityManager): Promise<void> => {
        const usersPastStreakTime = await entityManager
          .createQueryBuilder()
          .select(
            `us.*, (date_trunc('day', us."lastViewAt" at time zone COALESCE(u.timezone, 'utc'))::date) AS "lastViewAtTz", u.timezone`,
          )
          .from(UserStreak, 'us')
          .innerJoin(User, 'u', 'u.id = us."userId"')
          .where(`us."currentStreak" != 0`)
          .andWhere(
            `(date_trunc('day', us. "lastViewAt" at time zone COALESCE(u.timezone, 'utc'))::date) < (date_trunc('day', now() at time zone COALESCE(u.timezone, 'utc'))::date) - interval '1 day' `,
          )
          .getRawMany();

        const userIdsToReset = [];
        usersPastStreakTime.map(async (userStreak) => {
          if (checkUserStreak(userStreak)) {
            userIdsToReset.push(userStreak.userId);
          }
        });

        if (!userIdsToReset.length) {
          logger.info('no user streaks to reset');
          return;
        }

        const updateResult = await con
          .createQueryBuilder()
          .update(UserStreak)
          .set({ currentStreak: 0 })
          .where('userId IN (:...userIds)', { userIds: userIdsToReset })
          .execute();
        streakCounter.add(usersPastStreakTime.length, {
          type: 'users_in_cron',
        });
        streakCounter.add(updateResult.affected, { type: 'users_updated' });
      });
      logger.info('updated current streak cron');
    } catch (err) {
      logger.error({ err }, 'failed to update current streak cron');
    }
  },
};

export default cron;
