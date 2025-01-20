import cron from '../../src/cron/cleanGiftedPlus';
import { expectSuccessfulCron, saveFixtures } from '../helpers';
import { User } from '../../src/entity';
import { plusUsersFixture, usersFixture } from '../fixture';
import { DataSource, JsonContains } from 'typeorm';
import createOrGetConnection from '../../src/db';
import { addDays, subDays } from 'date-fns';
import { SubscriptionCycles } from '../../src/paddle';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  await saveFixtures(con, User, [...usersFixture, ...plusUsersFixture]);
});

it('should remove expired gifted plus subscription', async () => {
  const yesterdayDate = subDays(new Date(), 1);
  const tomorrowDate = addDays(new Date(), 1);

  // 5 total users:
  // - 1 is gifted and expired;
  // - 2 is gifted and NOT expired;
  // - 3 & 4 are not plus.
  // - 5 is classic yearly plus;
  await con.getRepository(User).update(
    { id: '1' },
    {
      subscriptionFlags: {
        giftExpirationDate: yesterdayDate,
        gifterId: '2',
        cycle: SubscriptionCycles.Yearly,
      },
    },
  );
  await con.getRepository(User).update(
    { id: '2' },
    {
      subscriptionFlags: {
        giftExpirationDate: tomorrowDate,
        gifterId: '3',
        cycle: SubscriptionCycles.Yearly,
      },
    },
  );

  const count = await con.getRepository(User).count({
    where: {
      subscriptionFlags: JsonContains({ cycle: SubscriptionCycles.Yearly }),
    },
  });
  // 1,2,5 are plus users
  expect(count).toEqual(3);

  await expectSuccessfulCron(cron);
  const users = await con.getRepository(User).find({
    order: { id: 'ASC' },
    select: ['subscriptionFlags', 'id'],
    where: {
      subscriptionFlags: JsonContains({ cycle: SubscriptionCycles.Yearly }),
    },
  });
  expect(users.length).toEqual(2);
  // 1 is the only removed user as it was gifted and expired
  expect(users[0].id).toEqual('2');
  expect(users[1].id).toEqual('5');
});
