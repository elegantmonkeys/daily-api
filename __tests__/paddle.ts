import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import { saveFixtures } from './helpers';
import { User } from '../src/entity';
import { plusUsersFixture, usersFixture } from './fixture';
import { EventName, SubscriptionCreatedEvent } from '@paddle/paddle-node-sdk';
import {
  PaddleCustomData,
  updateUserSubscription,
} from '../src/routes/webhooks/paddle';
import { isPlusMember, SubscriptionCycles } from '../src/paddle';
import { FastifyInstance } from 'fastify';
import appFunc from '../src';

let app: FastifyInstance;
let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
  app = await appFunc();
  return app.ready();
});

beforeEach(async () => {
  await saveFixtures(con, User, [...usersFixture, ...plusUsersFixture]);
});

const getSubscriptionData = (customData: PaddleCustomData) =>
  new SubscriptionCreatedEvent({
    event_id: '1',
    notification_id: '1',
    event_type: EventName.SubscriptionCreated,
    occurred_at: new Date().toISOString(),
    data: {
      id: '1',
      status: 'active',
      transaction_id: '1',
      customer_id: '1',
      address_id: '1',
      business_id: null,
      custom_data: customData,
      currency_code: 'USD',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      collection_mode: 'automatic',
      billing_cycle: {
        interval: 'month',
        frequency: 1,
      },
      items: [
        {
          price: {
            id: 'pricingGift',
            product_id: '1',
            description: 'Gift Subscription',
            tax_mode: 'internal',
          },
          status: 'active',
          quantity: 1,
          recurring: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    },
  });

describe('plus subscription', () => {
  it('should add a plus subscription to a user', async () => {
    const userId = '1';
    const user = await con.getRepository(User).findOneByOrFail({ id: userId });
    const isInitiallyPlus = isPlusMember(user.subscriptionFlags?.cycle);
    expect(isInitiallyPlus).toBe(false);

    const data = getSubscriptionData({
      user_id: userId,
    });
    await updateUserSubscription({ data, state: true });

    const updatedUser = await con
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    const isFinallyPlus = isPlusMember(updatedUser.subscriptionFlags?.cycle);
    expect(isFinallyPlus).toBe(true);
  });
});

describe('gift', () => {
  it('should ignore if gifter user is not valid', async () => {
    const userId = '2';
    const data = getSubscriptionData({
      user_id: userId,
      gifter_id: '10',
      duration: '1000',
    });
    const res = await updateUserSubscription({ data, state: true });
    expect(res).toBe(false);

    const updatedUser = await con
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    const isFinallyPlus = isPlusMember(updatedUser.subscriptionFlags?.cycle);
    expect(isFinallyPlus).toBe(false);
  });

  it('should ignore if gifter and user is the same', async () => {
    const userId = '2';
    const user = await con.getRepository(User).findOneByOrFail({ id: userId });
    const isInitiallyPlus = isPlusMember(user.subscriptionFlags?.cycle);
    expect(isInitiallyPlus).toBe(false);

    const data = getSubscriptionData({
      user_id: userId,
      gifter_id: userId,
      duration: '1000',
    });
    const res = await updateUserSubscription({ data, state: true });
    expect(res).toBe(false);

    const updatedUser = await con
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    const isFinallyPlus = isPlusMember(updatedUser.subscriptionFlags?.cycle);
    expect(isFinallyPlus).toBe(false);
  });

  it('should ignore if user is already plus', async () => {
    const userId = '1';
    await con
      .getRepository(User)
      .update(
        { id: userId },
        { subscriptionFlags: { cycle: SubscriptionCycles.Monthly } },
      );
    const user = await con.getRepository(User).findOneByOrFail({ id: userId });
    const isInitiallyPlus = isPlusMember(user.subscriptionFlags?.cycle);
    expect(isInitiallyPlus).toBe(true);

    const data = getSubscriptionData({
      user_id: user.id,
      gifter_id: '2',
      duration: '1000',
    });
    const res = await updateUserSubscription({ data, state: true });
    expect(res).toBe(false);
  });

  it('should gift a subscription to a user', async () => {
    const userId = '1';
    const user = await con.getRepository(User).findOneByOrFail({ id: '1' });
    const isInitiallyPlus = isPlusMember(user.subscriptionFlags?.cycle);

    expect(isInitiallyPlus).toBe(false);

    const data = getSubscriptionData({
      user_id: userId,
      gifter_id: '2',
      duration: '31557600000',
    });
    await updateUserSubscription({ data, state: true });

    const updatedUser = await con
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    const isFinallyPlus = isPlusMember(updatedUser.subscriptionFlags?.cycle);
    expect(isFinallyPlus).toBe(true);
    expect(updatedUser.subscriptionFlags?.gifterId).toBe('2');
    const expireDate =
      updatedUser.subscriptionFlags?.giftExpirationDate &&
      new Date(updatedUser.subscriptionFlags?.giftExpirationDate);
    expect(expireDate).toBeInstanceOf(Date);
    expect(expireDate?.getFullYear()).toBe(new Date().getFullYear() + 1);
  });
});
