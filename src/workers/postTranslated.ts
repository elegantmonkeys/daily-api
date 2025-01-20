import { TypedWorker } from './worker';
import { Post } from '../entity';
import { validLanguages } from '../types';
import { logger } from '../logger';

export const postTranslated: TypedWorker<'kvasir.v1.post-translated'> = {
  subscription: 'api.post-translated',
  handler: async (message, con) => {
    const { id, translations, language } = message.data;

    if (!validLanguages.includes(language)) {
      logger.error({ id, language }, '[postTranslated]: Invalid language');
      return;
    }

    try {
      await con
        .getRepository(Post)
        .createQueryBuilder()
        .update(Post)
        .set({
          translation: () => `jsonb_set(
          COALESCE(translation, '{}'::jsonb),
          '{${language}}',
          '${JSON.stringify(translations)}'::jsonb,
          true
        )`,
        })
        .where('id = :id', { id })
        .execute();

      logger.info(
        { id, language, keys: Object.keys(translations) },
        '[postTranslated]: Post translation updated',
      );
    } catch (error) {
      logger.error(
        { id, error },
        '[postTranslated]: Failed to update post translation',
      );
    }
  },
};
