import * as Twit from 'twit';

/* eslint-disable @typescript-eslint/camelcase */
const client = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
/* eslint-enable @typescript-eslint/camelcase */

export const tweet = async (status: string): Promise<void> => {
  await client.post('statuses/update', { status });
};
