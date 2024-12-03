import DataLoader, { BatchLoadFn } from 'dataloader';
import { Context } from './Context';
import { getShortUrl } from './common';
import { GQLSource } from './schema/sources';
import { ContentPreferenceSource } from './entity/contentPreference/ContentPreferenceSource';

export const defaultCacheKeyFn = <K extends object | string>(key: K) => {
  if (typeof key === 'object') {
    return JSON.stringify(key);
  }

  return key.toString();
};

export class DataLoaderService {
  protected loaders: Record<string, DataLoader<unknown, unknown>>;
  private ctx: Context;

  constructor({ ctx }: { ctx: Context }) {
    this.loaders = {};
    this.ctx = ctx;
  }

  protected getLoader<K, V>({
    type,
    loadFn,
    cacheKeyFn,
  }: {
    type: string;
    loadFn: (params: K) => Promise<V | null> | V;
    cacheKeyFn: (key: K) => string;
  }): DataLoader<K, V> {
    if (!this.loaders[type]) {
      const batchLoadFn: BatchLoadFn<K, V> = async (keys) => {
        const results = await Promise.allSettled(keys.map(loadFn));

        return results.map((result) => {
          if (result.status === 'rejected') {
            return result.reason;
          }

          return result.value;
        });
      };

      this.loaders[type] = new DataLoader(batchLoadFn, {
        cacheKeyFn,
        maxBatchSize: 30,
        name: `${DataLoaderService.name}.${type}`,
      });
    }

    return this.loaders[type] as DataLoader<K, V>;
  }

  get shortUrl() {
    return this.getLoader<string, string>({
      type: 'shortUrl',
      loadFn: (url) => getShortUrl(url, this.ctx.log),
      cacheKeyFn: defaultCacheKeyFn,
    });
  }

  get referralUrl() {
    return this.getLoader<
      {
        source: Pick<GQLSource, 'id' | 'handle' | 'public' | 'currentMember'>;
        userId: string;
      },
      string
    >({
      type: 'referralUrl',
      loadFn: async ({ source, userId }) => {
        const referralUrl = new URL(
          `/squads/${source.handle}`,
          process.env.COMMENTS_PREFIX,
        );

        if (source.public) {
          referralUrl.searchParams.append('cid', 'squad');
          referralUrl.searchParams.append('userid', userId);
        } else {
          let referralToken = source.currentMember?.referralToken;

          if (!referralToken) {
            const sourceMember: Pick<ContentPreferenceSource, 'flags'> | null =
              await this.ctx.con
                .getRepository(ContentPreferenceSource)
                .findOne({
                  select: ['flags'],
                  where: { referenceId: source.id, userId },
                });

            referralToken = sourceMember?.flags.referralToken;
          }

          if (!referralToken) {
            return null;
          }

          referralUrl.pathname = `/squads/${source.handle}/${referralToken}`;
        }

        const shortUrl = this.shortUrl.load(referralUrl.toString());

        return shortUrl;
      },
      cacheKeyFn: (key) => {
        const { source, userId } = key;
        const { id: sourceId } = source;

        return defaultCacheKeyFn({ sourceId, userId });
      },
    });
  }
}
