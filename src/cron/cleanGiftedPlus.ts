import { Cron } from './cron';
import { User } from '../entity';

const cron: Cron = {
  name: 'clean-gifted-plus',
  handler: async (con, logger) => {
    logger.info('cleaning gifted plus membership...');
    const timeThreshold = new Date();

    const { affected } = await con
      .getRepository(User)
      .createQueryBuilder('user')
      .update()
      .set({ subscriptionFlags: {} })
      .where('"user"."subscriptionFlags" ->> :expire  < :time', {
        expire: 'giftExpirationDate',
        time: timeThreshold,
      })
      .execute();

    logger.info({ count: affected }, 'expired gifted plus cleaned! 🎁');
  },
};

export default cron;
