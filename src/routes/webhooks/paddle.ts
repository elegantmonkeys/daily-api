import { FastifyInstance } from 'fastify';
import {
  Environment,
  EventName,
  Paddle,
  SubscriptionCanceledEvent,
  SubscriptionCreatedEvent,
  SubscriptionItemNotification,
  SubscriptionUpdatedEvent,
  TransactionItemNotification,
  TransactionPaidEvent,
} from '@paddle/paddle-node-sdk';
import createOrGetConnection from '../../db';
import { updateSubscriptionFlags } from '../../common';
import { User } from '../../entity';
import { logger } from '../../logger';
import { remoteConfig } from '../../remoteConfig';
import {
  AnalyticsEventName,
  sendAnalyticsEvent,
} from '../../integrations/analytics';

const paddleInstance = new Paddle(process.env.PADDLE_API_KEY, {
  environment: process.env.PADDLE_ENVIRONMENT as Environment,
});

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

const updateUserSubscription = async ({
  data,
  state,
}: {
  data: SubscriptionCreatedEvent | SubscriptionCanceledEvent | undefined;
  state: boolean;
}) => {
  if (!data) {
    return;
  }

  const customData = data.data?.customData as { user_id: string };

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
  await con.getRepository(User).update(
    {
      id: userId,
    },
    {
      subscriptionFlags: updateSubscriptionFlags({
        cycle: state ? subscriptionType : null,
        createdAt: state ? data.data?.startedAt : null,
        subscriptionId: state ? data.data?.id : null,
      }),
    },
  );
};

const logPaddleAnalyticsEvent = async (
  data:
    | SubscriptionUpdatedEvent
    | SubscriptionCanceledEvent
    | TransactionPaidEvent
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
  const userId = customData?.user_id || data?.data.id || '';
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
    cost,
    currency,
    payment,
  };

  await sendAnalyticsEvent([
    {
      event_name: eventName,
      event_timestamp: new Date(),
      app_platform: 'api',
      user_id: userId,
      extra: JSON.stringify(extra),
    },
  ]);
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
            const eventData = paddleInstance.webhooks.unmarshal(
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
                await updateUserSubscription({
                  data: eventData,
                  state: false,
                });
                await logPaddleAnalyticsEvent(
                  eventData,
                  AnalyticsEventName.CancelSubscription,
                );
                break;
              case EventName.SubscriptionUpdated:
                await logPaddleAnalyticsEvent(
                  eventData,
                  AnalyticsEventName.ChangeBillingCycle,
                );
                break;
              case EventName.TransactionPaid:
                await logPaddleAnalyticsEvent(
                  eventData,
                  AnalyticsEventName.ReceivePayment,
                );
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
