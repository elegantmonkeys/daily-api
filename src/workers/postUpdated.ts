import { messageToJson, Worker } from './worker';
import * as he from 'he';
import {
  addKeywords,
  addQuestions,
  addRelatedPosts,
  ArticlePost,
  bannedAuthors,
  CollectionPost,
  findAuthor,
  FreeformPost,
  getPostVisible,
  mergeKeywords,
  parseReadTime,
  Post,
  PostContentQuality,
  PostOrigin,
  PostRelationType,
  PostType,
  relatePosts,
  removeKeywords,
  SharePost,
  Source,
  Submission,
  SubmissionStatus,
  Toc,
  UNKNOWN_SOURCE,
  WelcomePost,
  YouTubePost,
} from '../entity';
import { SubmissionFailErrorKeys, SubmissionFailErrorMessage } from '../errors';
import { generateShortId } from '../ids';
import { FastifyBaseLogger } from 'fastify';
import { EntityManager } from 'typeorm';
import { parseDate, updateFlagsStatement } from '../common';
import { markdown } from '../common/markdown';
import { counters } from '../telemetry';
import { I18nRecord } from '../types';
import { insertCodeSnippetsFromUrl } from '../common/post';

interface Data {
  id: string;
  post_id: string;
  url: string;
  image?: string;
  title?: string;
  content_type?: string;
  reject_reason?: string;
  submission_id?: string;
  source_id?: string;
  origin?: string;
  published_at?: Date;
  updated_at?: Date;
  paid?: boolean;
  order?: number;
  collections?: string[];
  language?: string;
  extra?: {
    keywords?: string[];
    keywords_native?: string[];
    questions?: string[];
    summary?: string;
    description?: string;
    read_time?: number;
    canonical_url?: string;
    site_twitter?: string;
    creator_twitter?: string;
    toc?: Toc;
    content_curation?: string[];
    origin_entries?: string[];
    content: string;
    video_id?: string;
    duration?: number;
  };
  meta?: {
    scraped_html?: string;
    cleaned_trafilatura_xml?: string;
    translate_title?: {
      translations?: I18nRecord;
    };
    stored_code_snippets?: string;
  };
  content_quality?: PostContentQuality;
}

type HandleRejectionProps = {
  logger: FastifyBaseLogger;
  entityManager: EntityManager;
  data: Data;
};
const handleRejection = async ({
  logger,
  entityManager,
  data,
}: HandleRejectionProps) => {
  const { reject_reason, submission_id } = data;
  if (!submission_id) {
    // Check if we have a submission id, we need to notify
    logger.info({ data }, 'received rejection without submission id');
    return;
  }

  const submissionRepo = entityManager.getRepository(Submission);
  const submission = await submissionRepo.findOneBy({
    id: submission_id,
  });
  if (submission?.status === SubmissionStatus.Started) {
    await submissionRepo.save({
      ...submission,
      status: SubmissionStatus.Rejected,
      reason:
        reject_reason && reject_reason in SubmissionFailErrorMessage
          ? <SubmissionFailErrorKeys>reject_reason
          : SubmissionFailErrorKeys.GenericError,
    });
  }

  return;
};

type CreatePostProps = {
  logger: FastifyBaseLogger;
  entityManager: EntityManager;
  data: Partial<ArticlePost>;
  submissionId?: string;
  mergedKeywords: string[];
  questions: string[];
};

const handleCollectionRelations = async ({
  entityManager,
  post,
  originalData,
}: {
  entityManager: EntityManager;
  logger: FastifyBaseLogger;
  post: Pick<CollectionPost, 'id' | 'type'>;
  originalData: Data;
}) => {
  if (post.type === PostType.Collection) {
    await addRelatedPosts({
      entityManager,
      postId: post.id,
      yggdrasilIds: originalData.extra?.origin_entries || [],
      relationType: PostRelationType.Collection,
    });
  } else if (originalData.collections) {
    await relatePosts({
      entityManager,
      postId: post.id,
      yggdrasilIds: originalData.collections || [],
      relationType: PostRelationType.Collection,
    });
  }
};

const assignScoutToPostAndVordrFlags = async ({
  entityManager,
  submissionId,
  data,
}: Pick<CreatePostProps, 'entityManager' | 'submissionId' | 'data'>): Promise<
  Partial<Pick<Post, 'scoutId'> & { vordr: boolean }>
> => {
  const submission = await entityManager
    .getRepository(Submission)
    .findOneBy({ id: submissionId });

  if (!submission) {
    return {
      scoutId: undefined,
      vordr: undefined,
    };
  }

  if (data.authorId === submission.userId) {
    await entityManager.getRepository(Submission).update(
      { id: submissionId },
      {
        status: SubmissionStatus.Rejected,
        reason: SubmissionFailErrorKeys.ScoutIsAuthor,
      },
    );

    return {
      scoutId: undefined,
      vordr: submission.flags?.vordr,
    };
  }

  await entityManager.getRepository(Submission).update(
    { id: submissionId },
    {
      status: SubmissionStatus.Accepted,
    },
  );

  return {
    scoutId: submission.userId,
    vordr: submission.flags?.vordr,
  };
};

type CheckExistingPostProps = {
  entityManager: EntityManager;
  data: Partial<ArticlePost>;
  logger: FastifyBaseLogger;
  errorMsg: string;
  excludeId?: string;
};

/**
 * Function to check wheter an url/canonical url is already in use
 *
 * @param entityManager
 * @param data
 * @param logger
 * @param errorMsg
 * @param excludeId - By passing the id we only search for other posts containing these URLs
 */
const checkExistingUrl = async ({
  entityManager,
  data,
  logger,
  errorMsg,
  excludeId,
}: CheckExistingPostProps): Promise<boolean> => {
  let builder = entityManager
    .getRepository(Post)
    .createQueryBuilder()
    .select('id')
    .where(
      '(url = :url or url = :canonicalUrl or "canonicalUrl" = :url or "canonicalUrl" = :canonicalUrl)',
      { url: data.url, canonicalUrl: data.canonicalUrl },
    );
  if (excludeId) {
    builder = builder.andWhere('id != :excludeId', { excludeId });
  }
  const existingPost = await builder.getRawOne();
  if (existingPost) {
    counters?.background?.postError?.add(1, {
      reason: 'duplication_conflict',
    });
    logger.info({ data }, errorMsg);
    return true;
  }

  return false;
};

const createPost = async ({
  logger,
  entityManager,
  data,
  submissionId,
  mergedKeywords,
  questions,
}: CreatePostProps): Promise<Post | null> => {
  if (
    await checkExistingUrl({
      entityManager,
      data,
      logger,
      errorMsg: 'failed creating post because it exists already',
    })
  ) {
    return null;
  }

  if (submissionId) {
    const { scoutId, vordr } = await assignScoutToPostAndVordrFlags({
      entityManager,
      submissionId,
      data,
    });

    data.scoutId = scoutId;
    if (vordr === true) {
      data.banned = true;
      data.showOnFeed = false;

      data.flags = {
        ...data.flags,
        banned: true,
        showOnFeed: false,
      };
    }

    data.flags = {
      ...data.flags,
      vordr: vordr,
    };
  }

  const postId = await generateShortId();
  const postCreatedAt = new Date();
  data.id = postId;
  data.shortId = postId;
  data.createdAt = postCreatedAt;
  data.score = Math.floor(postCreatedAt.getTime() / (1000 * 60));
  data.origin = data?.scoutId
    ? PostOrigin.CommunityPicks
    : (data.origin ?? PostOrigin.Crawler);
  data.visible = getPostVisible({ post: data });
  data.visibleAt = data.visible ? postCreatedAt : null;
  data.flags = {
    ...data.flags,
    visible: data.visible,
  };

  const post = await entityManager
    .getRepository(
      contentTypeFromPostType[
        data.type as keyof typeof contentTypeFromPostType
      ] ?? ArticlePost,
    )
    .create(data);
  await entityManager.save(post);

  await addKeywords(entityManager, mergedKeywords, data.id);
  await addQuestions(entityManager, questions, data.id);

  return post;
};

const allowedFieldsMapping: Partial<Record<PostType, string[]>> = {
  freeform: [
    'contentCuration',
    'description',
    'metadataChangedAt',
    'readTime',
    'summary',
    'tagsStr',
    'contentMeta',
  ],
};

const contentTypeFromPostType: Record<PostType, typeof Post> = {
  [PostType.Article]: ArticlePost,
  [PostType.Freeform]: FreeformPost,
  [PostType.Share]: SharePost,
  [PostType.Welcome]: WelcomePost,
  [PostType.Collection]: CollectionPost,
  [PostType.VideoYouTube]: YouTubePost,
};

type UpdatePostProps = {
  logger: FastifyBaseLogger;
  entityManager: EntityManager;
  data: Partial<ArticlePost>;
  id: string;
  mergedKeywords: string[];
  questions: string[];
  content_type: PostType;
  submissionId?: string;
};
const updatePost = async ({
  logger,
  entityManager,
  data,
  id,
  mergedKeywords,
  questions,
  content_type = PostType.Article,
  submissionId,
}: UpdatePostProps) => {
  const postType = contentTypeFromPostType[content_type];
  let databasePost = await entityManager
    .getRepository(postType)
    .findOneBy({ id });

  // Update the post type in the database so that it matches the content type
  if (!databasePost) {
    await entityManager
      .createQueryBuilder()
      .update(Post)
      .set({ type: content_type, image: data.image })
      .where('id = :id', { id })
      .execute();

    databasePost = await entityManager
      .getRepository(postType)
      .findOneBy({ id });
  }

  if (data?.origin === PostOrigin.Squad) {
    data.sourceId = UNKNOWN_SOURCE;
  }

  if (
    !databasePost ||
    databasePost.metadataChangedAt.toISOString() >=
      data.metadataChangedAt!.toISOString()
  ) {
    counters?.background?.postError?.add(1, {
      reason: 'date_conflict',
    });
    logger.info(
      { data },
      'post not updated: database entry is newer than received update',
    );
    return null;
  }

  if (
    await checkExistingUrl({
      entityManager,
      data,
      logger,
      errorMsg: 'failed updating post because URL/canonical exists already',
      excludeId: databasePost?.id,
    })
  ) {
    return null;
  }

  if (submissionId && !databasePost.scoutId) {
    const { scoutId, vordr } = await assignScoutToPostAndVordrFlags({
      entityManager,
      submissionId,
      data,
    });

    data.scoutId = scoutId;
    if (vordr === true) {
      data.banned = true;
      data.showOnFeed = false;

      data.flags = {
        ...data.flags,
        banned: true,
        showOnFeed: false,
      };
    }

    data.flags = {
      ...data.flags,
      vordr: vordr,
    };
  }

  const title = data?.title || databasePost.title;

  data.id = databasePost.id;
  data.title = title;
  data.sourceId = data.sourceId || databasePost.sourceId;

  let updateBecameVisible = false;

  if (!databasePost.visible) {
    updateBecameVisible = getPostVisible({ post: { title } });
  }

  if (updateBecameVisible) {
    data.visible = true;
  } else {
    data.visible = databasePost.visible;
  }

  if (data.visible && !databasePost.visibleAt) {
    data.visibleAt = data.metadataChangedAt;
  }

  const jsonMetaFields: (keyof Pick<Post, 'contentMeta' | 'contentQuality'>)[] =
    ['contentMeta', 'contentQuality'];

  jsonMetaFields.forEach((metaField) => {
    if (
      Object.keys(data[metaField]!).length === 0 &&
      Object.keys(databasePost[metaField]).length > 0
    ) {
      data[metaField] = databasePost[metaField];
    }
  });

  if (
    data.contentQuality &&
    databasePost.contentQuality?.manual_clickbait_probability !== null
  ) {
    data.contentQuality.manual_clickbait_probability =
      databasePost.contentQuality.manual_clickbait_probability;
  }

  if (allowedFieldsMapping[content_type]) {
    const allowedFields = [
      'id',
      'visible',
      'visibleAt',
      'flags',
      'yggdrasilId',
      ...allowedFieldsMapping[content_type],
    ];

    Object.keys(data).forEach((key) => {
      if (allowedFields.indexOf(key) === -1) {
        delete data[key as keyof typeof data];
      }
    });
  }

  await entityManager.getRepository(postType).update(
    { id: databasePost.id },
    {
      ...data,
      flags: updateFlagsStatement<Post>({
        ...data.flags,
        visible: data.visible,
      }),
    },
  );

  if (updateBecameVisible) {
    await entityManager.getRepository(SharePost).update(
      { sharedPostId: data.id },
      {
        visible: true,
        visibleAt: data.visibleAt,
        private: data.private,
        flags: updateFlagsStatement<Post>({
          ...data.flags,
          private: data.private,
          visible: true,
        }),
      },
    );
  }

  if (databasePost.tagsStr !== data.tagsStr) {
    if (databasePost.tagsStr?.length) {
      await removeKeywords(
        entityManager,
        databasePost.tagsStr.split(','),
        data.id,
      );
    }
    await addKeywords(entityManager, mergedKeywords, data.id);
  }

  await addQuestions(entityManager, questions, data.id, true);
  return;
};

type GetSourcePrivacyProps = {
  logger: FastifyBaseLogger;
  entityManager: EntityManager;
  data: Data;
};
const getSourcePrivacy = async ({
  logger,
  entityManager,
  data,
}: GetSourcePrivacyProps): Promise<boolean | undefined> => {
  try {
    let query = entityManager
      .getRepository(Source)
      .createQueryBuilder('source')
      .select(['source.private']);

    // If we don't have a source id, we need to find the source id from the post
    if (!data?.source_id || data?.source_id === UNKNOWN_SOURCE) {
      query = query.innerJoinAndSelect(
        'source.posts',
        'posts',
        'posts.id = :id',
        { id: data?.post_id },
      );
    } else {
      query = query.where('source.id = :id', { id: data?.source_id });
    }

    const source = await query.getOne();

    // if source is not found this will return undefined
    // and DB will default to false, which means post will be public
    return !!source?.private;
  } catch (err) {
    // in case of an error it will return undefined
    // and DB will default to false, which means post will be public

    logger.error({ data, err }, 'failed find source for post');
  }
};

type FixDataProps = {
  logger: FastifyBaseLogger;
  entityManager: EntityManager;
  data: Data;
};
type FixData = {
  mergedKeywords: string[];
  questions: string[];
  content_type: PostType;
  fixedData: Partial<ArticlePost> &
    Partial<CollectionPost> &
    Partial<YouTubePost>;
};
const fixData = async ({
  logger,
  entityManager,
  data,
}: FixDataProps): Promise<FixData> => {
  const creatorTwitter =
    data?.extra?.creator_twitter === '' || data?.extra?.creator_twitter === '@'
      ? null
      : data?.extra?.creator_twitter;

  const authorId = await findAuthor(entityManager, creatorTwitter || undefined);
  const privacy = await getSourcePrivacy({
    logger,
    entityManager,
    data,
  });

  let keywords = data?.extra?.keywords;
  if (!data?.extra?.keywords && data?.content_type === PostType.VideoYouTube) {
    keywords = data?.extra?.keywords_native;
  }

  const { allowedKeywords, mergedKeywords } = await mergeKeywords(
    entityManager,
    keywords,
  );

  if (allowedKeywords.length > 5) {
    logger.info(
      {
        url: data.url,
        keywords: allowedKeywords,
      },
      'created an article with more than 5 keywords',
    );
  }

  const duration = data?.extra?.duration
    ? data?.extra?.duration / 60
    : undefined;

  // Try and fix generic data here
  return {
    mergedKeywords,
    questions: data?.extra?.questions || [],
    content_type: data?.content_type as PostType,
    fixedData: {
      origin: data?.origin as PostOrigin,
      authorId,
      creatorTwitter,
      url: data?.url,
      canonicalUrl: data?.extra?.canonical_url || data?.url,
      image: data?.image,
      sourceId: data?.source_id,
      title: data?.title && he.decode(data?.title),
      readTime: parseReadTime(data?.extra?.read_time || duration),
      publishedAt: parseDate(data?.published_at),
      metadataChangedAt: parseDate(data?.updated_at) || new Date(),
      tagsStr: allowedKeywords?.join(',') || null,
      private: privacy,
      sentAnalyticsReport: privacy || !authorId,
      summary: data?.extra?.summary,
      description: data?.extra?.description,
      siteTwitter: data?.extra?.site_twitter,
      toc: data?.extra?.toc,
      contentCuration: data?.extra?.content_curation,
      showOnFeed: !data?.order,
      flags: {
        private: privacy,
        showOnFeed: !data?.order,
        sentAnalyticsReport: privacy || !authorId,
      },
      yggdrasilId: data?.id,
      type: data?.content_type as PostType,
      content: data?.extra?.content,
      contentHtml: data?.extra?.content
        ? markdown.render(data.extra.content)
        : undefined,
      videoId: data?.extra?.video_id,
      language: data?.language,
      contentMeta: data?.meta || {},
      contentQuality: data?.content_quality || {},
    },
  };
};

const worker: Worker = {
  subscription: 'api.content-published',
  handler: async (message, con, logger): Promise<void> => {
    const data: Data = messageToJson(message);
    logger.info({ data }, 'content-updated received');
    try {
      // See if we received any rejections
      const { reject_reason } = data;
      await con.transaction(async (entityManager) => {
        if (reject_reason) {
          return handleRejection({ logger, data, entityManager });
        }

        const creatorTwitter = data?.extra?.creator_twitter;

        if (creatorTwitter && bannedAuthors.indexOf(creatorTwitter) > -1) {
          logger.info(
            { data, messageId: message.messageId },
            'post update failed because author is banned',
          );
          return;
        }

        let postId: string | undefined = data.post_id;

        if (!postId && data.id) {
          const matchedYggdrasilPost = await con
            .createQueryBuilder()
            .from(Post, 'p')
            .select('p.id as id')
            .where('p."yggdrasilId" = :id', { id: data.id })
            .getRawOne<{
              id: string;
            }>();

          postId = matchedYggdrasilPost?.id;
        }

        const { mergedKeywords, questions, content_type, fixedData } =
          await fixData({
            logger,
            entityManager,
            data,
          });

        // See if post id is not available
        if (!postId) {
          // Handle creation of new post
          const newPost = await createPost({
            logger,
            entityManager,
            data: fixedData,
            submissionId: data?.submission_id,
            mergedKeywords,
            questions,
          });

          postId = newPost?.id;
        } else {
          // Handle update of existing post
          await updatePost({
            logger,
            entityManager,
            data: fixedData,
            id: postId,
            mergedKeywords,
            questions,
            content_type,
            submissionId: data?.submission_id,
          });
        }

        if (postId) {
          // temp wrapper to avoid any issue with post processing
          // while we test code snippets insertion
          const safeInsertCodeSnippets = async () => {
            try {
              await insertCodeSnippetsFromUrl({
                entityManager,
                post: {
                  id: postId,
                },
                codeSnippetsUrl: data?.meta?.stored_code_snippets,
              });
            } catch (err) {
              logger.error(
                {
                  postId,
                  codeSnippetsUrl: data?.meta?.stored_code_snippets,
                  err,
                },
                'failed to save code snippets for post',
              );
            }
          };

          await Promise.all([
            handleCollectionRelations({
              entityManager,
              logger,
              post: {
                id: postId,
                type: content_type,
              },
              originalData: data,
            }),
            safeInsertCodeSnippets(),
          ]);
        }
      });
    } catch (err) {
      logger.error(
        { data, messageId: message.messageId, err },
        'failed to update post',
      );
    }
  },
};

export default worker;
