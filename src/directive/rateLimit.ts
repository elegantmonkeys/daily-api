import {
  RateLimitKeyGenerator,
  RateLimitOnLimit,
  RateLimitOptions,
  defaultKeyGenerator,
  rateLimitDirective,
} from 'graphql-rate-limit-directive';
import {
  IRateLimiterRedisOptions,
  RateLimiterRedis,
} from 'rate-limiter-flexible';
import { GraphQLError } from 'graphql';
import { singleRedisClient } from '../redis';
import { Context } from '../Context';
import { logger } from '../logger';
import { WATERCOOLER_ID } from '../common';

export class CustomRateLimiterRedis extends RateLimiterRedis {
  constructor(props: IRateLimiterRedisOptions) {
    super(props);
  }

  // Currently not doing any special actions/overrides
  // This was primarily introduced to make debugging easier by logging the details of rate limited queries/mutations after receiving a request
  consume(
    key: string | number,
    pointsToConsume?: number,
    options?: { [key: string]: unknown },
  ) {
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[CONSUME] ${key} for ${pointsToConsume}`);
    }

    return super.consume(key, pointsToConsume, options);
  }
}

const keyGenerator: RateLimitKeyGenerator<Context> = (
  directiveArgs,
  source,
  args,
  context,
  info,
) => {
  {
    switch (info.fieldName) {
      case 'createFreeformPost':
      case 'submitExternalLink':
      case 'sharePost':
        return `${context.userId ?? context.trackingId}:createPost`;
      case 'commentOnPost':
      case 'commentOnComment':
        return `${context.userId ?? context.trackingId}:createComment`;
      default:
        return `${context.userId ?? context.trackingId}:${defaultKeyGenerator(
          directiveArgs,
          source,
          args,
          context,
          info,
        )}`;
    }
  }
};

class RateLimitError extends GraphQLError {
  extensions = {};
  message = '';

  constructor({
    msBeforeNextReset,
    message,
  }: {
    msBeforeNextReset?: number;
    message?: string;
  }) {
    const seconds = (msBeforeNextReset / 1000).toFixed(0);
    message = message ?? `Too many requests, please try again in ${seconds}s`;
    super(message);

    this.message = message;
    this.extensions = { code: 'RATE_LIMITED' };
  }
}

export const onLimit: RateLimitOnLimit<Context> = (
  resource,
  _,
  __,
  ___,
  context,
  info,
) => {
  switch (info.fieldName) {
    case 'createFreeformPost':
    case 'submitExternalLink':
    case 'sharePost':
      context.rateLimitCouner.add(1, { type: 'createPost' });
      throw new RateLimitError({
        message: 'Take a break. You already posted enough in the last hour',
      });
    case 'commentOnPost':
    case 'commentOnComment':
      context.rateLimitCouner.add(1, { type: 'createComment' });
      throw new RateLimitError({
        message: 'Take a break. You already commented enough in the last hour',
      });
    default:
      context.rateLimitCouner.add(1, { type: 'default' });
      throw new RateLimitError({ msBeforeNextReset: resource.msBeforeNext });
  }
};

export const rateLimiterName = 'rateLimit';
const rateLimiterConfig: RateLimitOptions<Context, IRateLimiterRedisOptions> = {
  keyGenerator,
  onLimit,
  name: rateLimiterName,
  limiterOptions: {
    storeClient: singleRedisClient,
  },
  limiterClass: CustomRateLimiterRedis,
};

const { rateLimitDirectiveTransformer, rateLimitDirectiveTypeDefs } =
  rateLimitDirective(rateLimiterConfig);

export const highRateLimiterName = 'watercoolerRateLimit';
const {
  rateLimitDirectiveTransformer: highRateLimitTransformer,
  rateLimitDirectiveTypeDefs: highRateLimitTypeDefs,
} = rateLimitDirective({
  ...rateLimiterConfig,
  name: highRateLimiterName,
  pointsCalculator: (_, __, args) =>
    (args.sourceId as string) === WATERCOOLER_ID ? 1 : 0,
});

export const rateLimiterTransformers = (schema) =>
  highRateLimitTransformer(rateLimitDirectiveTransformer(schema));

export const rateLimitTypeDefs = [
  rateLimitDirectiveTypeDefs,
  highRateLimitTypeDefs,
];
