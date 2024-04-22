import { RedisPubSub } from '@dailydotdev/graphql-redis-subscriptions';
import { IORedisPool, IORedisPoolOptions } from '@dailydotdev/ts-ioredis-pool';
import Redis from 'ioredis';

export const redisOptions = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  password: process.env.REDIS_PASS,
};

export const redisPubSub = new RedisPubSub({
  connection: redisOptions,
});

export const singleRedisClient = new Redis(redisOptions);

const ioRedisPoolOpts = IORedisPoolOptions.fromHostAndPort(
  redisOptions.host,
  redisOptions.port,
)
  .withIORedisOptions(redisOptions)
  .withPoolOptions({
    min: 10,
    max: 50,
    evictionRunIntervalMillis: 60000,
    idleTimeoutMillis: 30000,
  });

export const ioRedisPool = new IORedisPool(ioRedisPoolOpts);

export function deleteKeysByPattern(pattern: string): Promise<void> {
  return ioRedisPool.execute(
    (client) =>
      new Promise((resolve, reject) => {
        const stream = client.scanStream({ match: pattern });
        stream.on('data', (keys) => {
          if (keys.length) {
            client.unlink(keys);
          }
        });
        stream.on('end', resolve);
        stream.on('error', reject);
      }),
  );
}

export const deleteRedisKey = (...keys: string[]): Promise<number> =>
  ioRedisPool.execute((client) => client.unlink(...keys));

export const ONE_MINUTE_IN_SECONDS = 60;
export const ONE_HOUR_IN_SECONDS = 60 * 60;
export const ONE_DAY_IN_SECONDS = ONE_HOUR_IN_SECONDS * 24;
export const ONE_WEEK_IN_SECONDS = ONE_DAY_IN_SECONDS * 7;

export enum RedisMagicValues {
  SLEEPING = 'SLEEPING',
}

type RedisObject = string | Buffer | number;

export const setRedisObject = (key: string, value: RedisObject) =>
  ioRedisPool.execute((client) => client.set(key, value));

export const setRedisObjectWithExpiry = (
  key: string,
  value: RedisObject,
  seconds: number,
) => ioRedisPool.execute((client) => client.set(key, value, 'EX', seconds));

export const getRedisObject = (key) =>
  ioRedisPool.execute((client) => client.get(key));

export const getRedisKeysByPattern = (pattern: string) => {
  console.log('getRedisKeysByPattern', pattern);
  return ioRedisPool.execute((client) => client.keys(pattern));
};
