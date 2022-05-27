import flagsmith from 'flagsmith-nodejs';
import { ioRedisPool } from './redis';

const getKey = (key: string): string => `flagsmith:${key}`;

flagsmith.init({
  environmentID: process.env.FLAGSMITH_KEY,
  cache: {
    has: async (key) => {
      const reply = await ioRedisPool.execute(async (client) => {
        return await client.exists(getKey(key));
      });
      return reply === 1;
    },
    get: async (key) => {
      const cacheValue = await ioRedisPool.execute(async (client) => {
        return await client.get(getKey(key));
      });
      return cacheValue && JSON.parse(cacheValue);
    },
    set: async (key, value) => {
      await ioRedisPool.execute(async (client) => {
        return await client.set(
          getKey(key),
          JSON.stringify(value),
          'ex',
          60 * 60,
        );
      });
    },
  },
});

export default flagsmith;
