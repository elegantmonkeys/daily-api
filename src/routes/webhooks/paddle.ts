import { FastifyInstance } from 'fastify';
import {
  EventName,
  type SubscriptionCanceledEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionItemNotification,
  type SubscriptionUpdatedEvent,
  type TransactionCompletedEvent,
  type TransactionItemNotification,
} from '@paddle/paddle-node-sdk';
import createOrGetConnection from '../../db';
import { updateSubscriptionFlags, webhooks } from '../../common';
import { User } from '../../entity';
import { logger } from '../../logger';
import { remoteConfig } from '../../remoteConfig';
import {
  AnalyticsEventName,
  sendAnalyticsEvent,
} from '../../integrations/analytics';
import { JsonContains } from 'typeorm';
import { paddleInstance } from '../../common/paddle';
import { addMilliseconds } from 'date-fns';
import { isPlusMember } from '../../paddle';

const extractSubscriptionType = (
  items:
    | SubscriptionItemNotification[]
    | TransactionItemNotification[]
    | undefined,
): string => {
  if (!items) {
    return '';
  }
  return items.reduce((acc, item) => {
    const pricingIds = remoteConfig.vars?.pricingIds;
    if (item.price?.id && pricingIds?.[item.price.id]) {
      acc = pricingIds?.[item.price.id] || '';
    }
    return acc;
  }, '');
};

export interface PaddleCustomData {
  user_id?: string;
  duration?: string;
  gifter_id?: string;
}

export const updateUserSubscription = async ({
  data,
  state,
}: {
  data:
    | SubscriptionCreatedEvent
    | SubscriptionCanceledEvent
    | SubscriptionUpdatedEvent
    | undefined;
  state: boolean;
}) => {
  if (!data) {
    return;
  }

  const customData: PaddleCustomData = data.data?.customData ?? {};

  const con = await createOrGetConnection();
  const userId = customData?.user_id;
  if (!userId) {
    logger.error({ type: 'paddle' }, 'User ID missing in payload');
    return false;
  }

  const subscriptionType = extractSubscriptionType(data.data?.items);

  if (!subscriptionType) {
    logger.error(
      {
        type: 'paddle',
        data,
      },
      'Subscription type missing in payload',
    );
    return false;
  }

  const { gifter_id: gifterId, duration } = customData;
  const durationTime = duration && parseInt(duration);
  const isGift = !!durationTime && gifterId;
  if (isGift) {
    if (userId === gifterId) {
      logger.error({ type: 'paddle', data }, 'User and gifter are the same');
      return false;
    }

    if (!durationTime || durationTime <= 0) {
      logger.error({ type: 'paddle', data }, 'Invalid duration');
      return false;
    }

    const gifterUser = await con
      .getRepository(User)
      .findOneBy({ id: gifterId });
    if (!gifterUser) {
      logger.error({ type: 'paddle', data }, 'Gifter user not found');
      return false;
    }

    const targetUser = await con.getRepository(User).findOne({
      select: ['subscriptionFlags'],
      where: { id: userId },
    });
    if (isPlusMember(targetUser?.subscriptionFlags?.cycle)) {
      logger.error({ type: 'paddle', data }, 'User is already a Plus member');
      return false;
    }
  }

  await con.getRepository(User).update(
    {
      id: userId,
    },
    {
      subscriptionFlags: updateSubscriptionFlags({
        cycle: state ? subscriptionType : null,
        createdAt: state ? data.data?.startedAt : null,
        subscriptionId: state ? data.data?.id : null,
        ...(isGift && {
          gifterId,
          giftExpirationDate: addMilliseconds(
            new Date(),
            durationTime,
          ).toISOString(),
        }),
      }),
    },
  );
};

const getUserId = async ({
  subscriptionId,
  userId,
}: {
  subscriptionId?: false | string | null;
  userId?: string | undefined;
}): Promise<string> => {
  if (userId) {
    return userId;
  }

  const con = await createOrGetConnection();
  const user = await con.getRepository(User).findOne({
    where: { subscriptionFlags: JsonContains({ subscriptionId }) },
    select: ['id'],
  });

  if (!user) {
    logger.error({ type: 'paddle', subscriptionId, userId }, 'User not found');
    return '';
  }

  return user.id;
};

const planChanged = async (data: SubscriptionUpdatedEvent) => {
  const customData = data.data?.customData as { user_id: string };
  const userId = await getUserId({
    userId: customData?.user_id,
    subscriptionId: data.data?.id,
  });
  const con = await createOrGetConnection();
  const flags = await con.getRepository(User).findOne({
    where: { id: userId },
    select: ['subscriptionFlags'],
  });

  return (
    (flags?.subscriptionFlags?.cycle as string) !==
    extractSubscriptionType(data.data?.items)
  );
};

const logPaddleAnalyticsEvent = async (
  data:
    | SubscriptionUpdatedEvent
    | SubscriptionCanceledEvent
    | TransactionCompletedEvent
    | undefined,
  eventName: AnalyticsEventName,
) => {
  if (!data) {
    return;
  }

  const customData = data.data?.customData as { user_id: string };
  const cycle = extractSubscriptionType(data.data?.items);
  const cost = data.data?.items?.[0]?.price?.unitPrice?.amount;
  const currency = data.data?.items?.[0]?.price?.unitPrice?.currencyCode;
  const localCost = (data as TransactionCompletedEvent).data?.details?.totals
    ?.total;
  const localCurrency = data.data?.currencyCode;
  const userId = await getUserId({
    userId: customData?.user_id,
    subscriptionId:
      ('subscriptionId' in data.data && data.data.subscriptionId) ||
      data.data.id,
  });
  if (!userId) {
    return;
  }

  const payment =
    'payments' in data.data &&
    data.data?.payments?.reduce((acc, item) => {
      if (item.status === 'captured') {
        acc = item?.methodDetails?.type || '';
      }
      return acc;
    }, '');

  const extra = {
    cycle,
    cost: cost ? parseInt(cost) / 100 : undefined,
    currency,
    payment,
    localCost: localCost ? parseInt(localCost) / 100 : undefined,
    localCurrency,
  };

  await sendAnalyticsEvent([
    {
      event_name: eventName,
      event_timestamp: new Date(data.occurredAt),
      event_id: data?.eventId,
      app_platform: 'api',
      user_id: userId,
      extra: JSON.stringify(extra),
    },
  ]);
};

const concatText = (a: string, b: string) => [a, b].filter(Boolean).join(`\n`);
const notifyNewPaddleTransaction = async ({
  data,
}: TransactionCompletedEvent) => {
  const customData = data?.customData as { user_id: string };
  const userId = await getUserId({
    userId: customData?.user_id,
    subscriptionId: 'subscriptionId' in data && data.subscriptionId,
  });
  const origin = data?.origin;
  const productId = data?.items?.[0].price?.productId;

  const total = data?.items?.[0]?.price?.unitPrice?.amount || '0';
  const currencyCode =
    data?.items?.[0]?.price?.unitPrice?.currencyCode || 'USD';

  const localTotal = data?.details?.totals?.total || '0';
  const localCurrencyCode = data?.currencyCode || 'USD';

  await webhooks.transactions.send({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text:
            origin === 'subscription_recurring'
              ? 'Recurring payment :pepemoney:'
              : 'New Plus subscriber :moneybag:',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: concatText(
              '*Transaction ID:*',
              `<https://vendors.paddle.com/transactions-v2/${data.id}|${data.id}>`,
            ),
          },
          {
            type: 'mrkdwn',
            text: concatText(
              '*Customer ID:*',
              `<https://vendors.paddle.com/customers-v2/${data.customerId}|${data.customerId}>`,
            ),
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: concatText(
              '*Type:*',
              `<https://vendors.paddle.com/products-v2/${productId}|${extractSubscriptionType(data?.items)}>`,
            ),
          },
          {
            type: 'mrkdwn',
            text: concatText(
              '*Purchased by:*',
              `<https://app.daily.dev/${userId}|${userId}>`,
            ),
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: concatText(
              '*Cost:*',
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode,
              }).format((parseFloat(total) || 0) / 100),
            ),
          },
          {
            type: 'mrkdwn',
            text: concatText('*Currency:*', currencyCode),
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: concatText(
              '*Cost (local):*',
              new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: localCurrencyCode,
              }).format((parseFloat(localTotal) || 0) / 100),
            ),
          },
          {
            type: 'mrkdwn',
            text: concatText('*Currency (local):*', localCurrencyCode),
          },
        ],
      },
    ],
  });
};

export const paddle = async (fastify: FastifyInstance): Promise<void> => {
  fastify.register(async (fastify: FastifyInstance): Promise<void> => {
    fastify.post('/', {
      config: {
        rawBody: true,
      },
      handler: async (req, res) => {
        const signature = (req.headers['paddle-signature'] as string) || '';
        const rawRequestBody = req.rawBody?.toString();
        const secretKey = process.env.PADDLE_WEBHOOK_SECRET || '';

        try {
          if (signature && rawRequestBody) {
            const eventData = await paddleInstance.webhooks.unmarshal(
              rawRequestBody,
              secretKey,
              signature,
            );

            switch (eventData?.eventType) {
              case EventName.SubscriptionCreated:
                await updateUserSubscription({
                  data: eventData,
                  state: true,
                });
                break;
              case EventName.SubscriptionCanceled:
                Promise.all([
                  updateUserSubscription({
                    data: eventData,
                    state: false,
                  }),
                  logPaddleAnalyticsEvent(
                    eventData,
                    AnalyticsEventName.CancelSubscription,
                  ),
                ]);
                break;
              case EventName.SubscriptionUpdated:
                const didPlanChange = await planChanged(eventData);
                if (didPlanChange) {
                  await updateUserSubscription({
                    data: eventData,
                    state: true,
                  });
                  await logPaddleAnalyticsEvent(
                    eventData,
                    AnalyticsEventName.ChangeBillingCycle,
                  );
                }
                break;
              case EventName.TransactionCompleted:
                Promise.all([
                  logPaddleAnalyticsEvent(
                    eventData,
                    AnalyticsEventName.ReceivePayment,
                  ),
                  notifyNewPaddleTransaction(eventData),
                ]);
                break;
              default:
                logger.info({ type: 'paddle' }, eventData?.eventType);
            }
          } else {
            logger.error({ type: 'paddle' }, 'Signature missing in header');
          }
        } catch (e) {
          logger.error({ type: 'paddle', e }, 'Paddle generic error');
        }
        res.send('Processed webhook event');
      },
    });
  });
};
