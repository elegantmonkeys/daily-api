import {
  AdvancedSettings,
  Feed,
  FeedAdvancedSettings,
  FeedType,
  SourceMember,
  SourceType,
  UserPost,
} from '../entity';
import {
  Brackets,
  DataSource,
  ObjectLiteral,
  QueryBuilder,
  SelectQueryBuilder,
  type EntityManager,
} from 'typeorm';
import { Connection, ConnectionArguments } from 'graphql-relay';
import { IFieldResolver } from '@graphql-tools/utils';
import { Bookmark, Post, View, PostKeyword, Source } from '../entity';
import { GQLPost } from '../schema/posts';
import { Context } from '../Context';
import {
  Page,
  PageGenerator,
  getSearchQuery,
  processSearchQuery,
} from '../schema/common';
import graphorm from '../graphorm';
import { mapArrayToOjbect } from './object';
import { runInSpan } from '../telemetry';
import { whereVordrFilter } from './vordr';
import { baseFeedConfig, type FeedFlagsFilters } from '../integrations/feed';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceKeyword } from '../entity/contentPreference/ContentPreferenceKeyword';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../entity/contentPreference/types';
import { ContentPreference } from '../entity/contentPreference/ContentPreference';
import { ContentPreferenceWord } from '../entity/contentPreference/ContentPreferenceWord';
import { ContentPreferenceUser } from '../entity/contentPreference/ContentPreferenceUser';

export const WATERCOOLER_ID = 'fd062672-63b7-4a10-87bd-96dcd10e9613';

export const whereTags = (
  tags: string[],
  builder: SelectQueryBuilder<Post>,
  alias: string,
  variableAlias = 'tags',
): string => {
  const query = builder
    .subQuery()
    .select('1')
    .from(PostKeyword, 'pk')
    .where(`pk.keyword IN (:...${variableAlias})`, { [variableAlias]: tags })
    .andWhere(`pk.postId = ${alias}.id`)
    .getQuery();
  return `EXISTS${query}`;
};

export const whereNotTags = (
  tags: string[],
  builder: SelectQueryBuilder<Post>,
  alias: string,
): string => {
  return `NOT ${whereTags(tags, builder, alias, 'blockedTags')}`;
};

export const whereKeyword = (
  keyword: string,
  builder: SelectQueryBuilder<Post>,
  alias: string,
): string => {
  const query = builder
    .subQuery()
    .select('1')
    .from(PostKeyword, 'pk')
    .where(`pk.keyword = :keyword`, { keyword })
    .andWhere(`pk."postId" = ${alias}.id`)
    .getQuery();
  return `EXISTS${query}`;
};

const rawFilterSelect = <T extends ObjectLiteral>(
  con: DataSource | EntityManager,
  name: string,
  func: (qb: QueryBuilder<T>) => QueryBuilder<T>,
): QueryBuilder<T> =>
  con.createQueryBuilder().select('jsonb_agg(res)', name).from(func, 'res');

type RawFiltersData = {
  settings:
    | Pick<
        AdvancedSettings,
        'id' | 'defaultEnabledState' | 'group' | 'options'
      >[]
    | null;
  feedAdvancedSettings:
    | Pick<FeedAdvancedSettings, 'advancedSettingsId' | 'enabled'>[]
    | null;
  tags: Pick<ContentPreferenceKeyword, 'keywordId' | 'status'>[] | null;
  words: Pick<ContentPreferenceWord, 'referenceId'>[] | null;
  users: Pick<ContentPreferenceUser, 'referenceId' | 'status'>[] | null;
  sources: Pick<ContentPreferenceSource, 'sourceId' | 'status'>[] | null;
  memberships: { sourceId: SourceMember['sourceId']; hide: boolean }[] | null;
  feeds: Pick<Feed, 'flags' | 'type'>[] | null;
};

const getRawFiltersData = async (
  con: DataSource | EntityManager,
  feedId: string,
  userId: string,
): Promise<RawFiltersData | undefined> => {
  const isMainFeed = feedId === userId;

  const selects = [
    rawFilterSelect(con, 'settings', (qb) =>
      qb
        .select(['id', '"defaultEnabledState"', '"group"', 'options'])
        .from(AdvancedSettings, 't'),
    ),
    rawFilterSelect(con, 'feedAdvancedSettings', (qb) =>
      qb
        .select(['"advancedSettingsId"', 'enabled'])
        .from(FeedAdvancedSettings, 't')
        .where('"feedId" = $1'),
    ),
    rawFilterSelect(con, 'tags', (qb) =>
      qb
        .select(['"keywordId"', 'status'])
        .from(ContentPreference, 't')
        .where('"feedId" = $1')
        .andWhere('"userId" = $2')
        .andWhere(`type = '${ContentPreferenceType.Keyword}'`),
    ),
    rawFilterSelect(con, 'users', (qb) =>
      qb
        .select(['"referenceId"', 'status'])
        .from(ContentPreference, 'u')
        .where('"feedId" = $1')
        .andWhere('"userId" = $2')
        .andWhere(`type = '${ContentPreferenceType.User}'`),
    ),
    rawFilterSelect(con, 'sources', (qb) =>
      qb
        .select(['"sourceId"', 'status'])
        .from(ContentPreference, 't')
        .where('"feedId" = $1')
        .andWhere('"userId" = $2')
        .andWhere(`type = '${ContentPreferenceType.Source}'`),
    ),
    rawFilterSelect(con, 'words', (qb) =>
      qb
        .select(['"referenceId"'])
        .from(ContentPreference, 'w')
        .where('"feedId" = $1')
        .andWhere('"userId" = $2')
        .andWhere(`type = '${ContentPreferenceType.Word}'`)
        .andWhere(`status = '${ContentPreferenceStatus.Blocked}'`),
    ),
    rawFilterSelect(con, 'memberships', (qb) =>
      qb
        .select('"sourceId"')
        .addSelect("COALESCE((flags->'hideFeedPosts')::boolean, FALSE)", 'hide')
        .from(SourceMember, 't')
        .where('"userId" = $2'),
    ),
  ];

  if (!isMainFeed) {
    selects.push(
      rawFilterSelect(con, 'feeds', (qb) =>
        qb
          .select(['flags', 'type'])
          .from(Feed, 't')
          .where('id = $1')
          .andWhere('"userId" = $2'),
      ),
    );
  }

  const query =
    'select ' + selects.map((select) => `(${select.getQuery()})`).join(', ');
  const res = await con.query(query, [feedId, userId]);
  return res[0];
};

export const getExcludedAdvancedSettings = ({
  settings,
  feedAdvancedSettings,
}: RawFiltersData): Partial<AdvancedSettings>[] => {
  const userSettings = mapArrayToOjbect(
    feedAdvancedSettings || [],
    'advancedSettingsId',
    'enabled',
  );
  const excludedSettings = (settings || []).filter((adv) => {
    if (userSettings[adv.id] !== undefined) {
      return userSettings[adv.id] === false;
    }

    return adv.defaultEnabledState === false;
  });
  return excludedSettings.map(({ id, group, options }) => ({
    id,
    group,
    options,
  }));
};

const advancedSettingsToFilters = (
  rawData: RawFiltersData,
): {
  excludeTypes: string[];
  blockedContentCuration: string[];
  excludeSourceTypes: string[];
} => {
  const settings = getExcludedAdvancedSettings(rawData);
  return settings.reduce<ReturnType<typeof advancedSettingsToFilters>>(
    (acc, curr) => {
      if (curr.options?.type) {
        if (curr.group === 'content_types') {
          acc.excludeTypes.push(curr.options.type);
        }
        if (curr.group === 'source_types') {
          acc.excludeSourceTypes.push(curr.options.type);
        }
        if (curr.group === 'content_curation') {
          acc.blockedContentCuration.push(curr.options.type);
        }
      }
      return acc;
    },
    { excludeTypes: [], blockedContentCuration: [], excludeSourceTypes: [] },
  );
};

const wordsToFilters = ({
  words,
}: RawFiltersData): {
  blockedWords: string[];
} => {
  return (words || []).reduce<ReturnType<typeof wordsToFilters>>(
    (acc, value) => {
      acc.blockedWords.push(value.referenceId);
      return acc;
    },
    { blockedWords: [] },
  );
};

const usersToFilters = ({
  users,
}: RawFiltersData): Record<'followingUsers' | 'excludeUsers', string[]> => {
  return (users || []).reduce<ReturnType<typeof usersToFilters>>(
    (acc, { referenceId, status }) => {
      if (status === ContentPreferenceStatus.Blocked) {
        acc.excludeUsers.push(referenceId);
      } else {
        acc.followingUsers.push(referenceId);
      }
      return acc;
    },
    { followingUsers: [], excludeUsers: [] },
  );
};

const tagsToFilters = ({
  tags,
}: RawFiltersData): {
  includeTags: string[];
  blockedTags: string[];
} => {
  return (tags || []).reduce<ReturnType<typeof tagsToFilters>>(
    (acc, value) => {
      if (value.status === ContentPreferenceStatus.Blocked) {
        acc.blockedTags.push(value.keywordId);
      } else {
        acc.includeTags.push(value.keywordId);
      }
      return acc;
    },
    { includeTags: [], blockedTags: [] },
  );
};

const sourcesToFilters = ({
  sources,
  memberships,
}: RawFiltersData): {
  excludeSources: string[];
  sourceIds: string[];
  followingSources: string[];
} => {
  const { blocked, following } = (sources || []).reduce<{
    blocked: string[];
    following: string[];
  }>(
    (acc, value) => {
      if (value.status === ContentPreferenceStatus.Blocked) {
        acc.blocked.push(value.sourceId);
      } else {
        acc.following.push(value.sourceId);
      }
      return acc;
    },
    { blocked: [], following: [] },
  );

  // Split memberships by hide flag
  const membershipsByHide = (memberships || []).reduce<{
    hide: string[];
    show: string[];
  }>(
    (acc, value) => {
      acc[value.hide ? 'hide' : 'show'].push(value.sourceId);
      return acc;
    },
    { hide: [], show: [] },
  );

  return {
    excludeSources: blocked.map((s) => s).concat(membershipsByHide.hide),
    sourceIds: membershipsByHide.show,
    followingSources: following,
  };
};

const feedFlagsToFilters = ({
  feeds,
}: RawFiltersData): {
  flags?: FeedFlagsFilters;
} => {
  const feed = feeds?.[0];
  const flagFilters: FeedFlagsFilters = {};

  if (!feed) {
    return {};
  }

  // we set flags only for custom feeds
  if (feed.type !== FeedType.Custom) {
    return {};
  }

  if (feed.flags.orderBy) {
    flagFilters.order_by = feed.flags.orderBy;
  }

  flagFilters.disable_engagement_filter = !!feed.flags.disableEngagementFilter;

  if (feed.flags.minDayRange) {
    flagFilters.min_day_range = feed.flags.minDayRange;
  }

  if (feed.flags.minUpvotes || feed.flags.minViews) {
    flagFilters.thresholds = {
      min_thresholds: {
        upvotes: feed.flags.minUpvotes,
        views: feed.flags.minViews,
      },
    };
  }

  return {
    flags: flagFilters,
  };
};

export const feedToFilters = async (
  con: DataSource | EntityManager,
  feedId?: string,
  userId?: string,
): Promise<AnonymousFeedFilters> => {
  if (!feedId || !userId) {
    return {};
  }

  const rawData = await getRawFiltersData(con, feedId, userId);
  if (!rawData) {
    return {};
  }

  return {
    ...advancedSettingsToFilters(rawData),
    ...tagsToFilters(rawData),
    ...sourcesToFilters(rawData),
    ...wordsToFilters(rawData),
    ...usersToFilters(rawData),
    ...feedFlagsToFilters(rawData),
  };
};

export const selectRead = (
  userId: string | undefined,
  builder: SelectQueryBuilder<Post>,
  alias: string,
): string => {
  const query = builder
    .select('1')
    .from(View, 'view')
    .where(`view.userId = :userId`, { userId: userId || '' })
    .andWhere(`view.postId = ${alias}.id`)
    .getQuery();
  return `EXISTS${query}`;
};

export const whereUnread = (
  userId: string | undefined,
  builder: SelectQueryBuilder<Post>,
  alias: string,
): string => `NOT ${selectRead(userId, builder.subQuery(), alias)}`;

export enum Ranking {
  POPULARITY = 'POPULARITY',
  TIME = 'TIME',
}

export interface FeedOptions {
  ranking: Ranking;
  supportedTypes?: string[];
  feedId?: string;
}

export type FeedArgs = ConnectionArguments & FeedOptions;

export const applyFeedWhere = (
  ctx: Context,
  builder: SelectQueryBuilder<Post>,
  alias: string,
  postTypes: string[],
  removeHiddenPosts = true,
  removeBannedPosts = true,
  allowPrivatePosts = true,
  allowSquadPosts = true,
  removeNonPublicThresholdSquads = true,
  sourceTypes: string[] = [],
): SelectQueryBuilder<Post> => {
  let newBuilder = builder.andWhere(`${alias}."type" in (:...postTypes)`, {
    postTypes,
  });
  if (!allowPrivatePosts) {
    newBuilder = newBuilder.andWhere(`${alias}."private" = false`);
  }

  if (!allowSquadPosts || removeNonPublicThresholdSquads) {
    newBuilder = newBuilder.innerJoin(
      Source,
      'source',
      `${alias}."sourceId" = source.id`,
    );
  }

  if (!allowSquadPosts) {
    newBuilder = newBuilder.andWhere(`source.type != '${SourceType.Squad}'`);
  }

  if (removeNonPublicThresholdSquads) {
    newBuilder = newBuilder.andWhere(
      `(source.type != '${SourceType.Squad}' OR (source.flags->>'publicThreshold')::boolean IS TRUE)`,
    );
  }

  if (sourceTypes.length > 0) {
    newBuilder = newBuilder.andWhere(`source.type IN (:...sourceTypes)`, {
      sourceTypes,
    });
  }

  if (ctx.userId && removeHiddenPosts) {
    newBuilder = newBuilder
      .leftJoin(
        UserPost,
        'userpost',
        `userpost."postId" = "${alias}".id AND userpost."userId" = :userId AND userpost.hidden = TRUE`,
        { userId: ctx.userId },
      )
      .andWhere('userpost."postId" IS NULL');
  }
  if (removeBannedPosts) {
    newBuilder = newBuilder
      .andWhere(`"${alias}".banned = FALSE`)
      .andWhere(`"${alias}"."showOnFeed" = TRUE`);
  }
  return newBuilder;
};

export type FeedResolverOptions<TArgs, TParams, TPage extends Page> = {
  removeHiddenPosts?: boolean;
  removeBannedPosts?: boolean;
  fetchQueryParams?: (
    ctx: Context,
    args: TArgs,
    page: TPage,
  ) => Promise<TParams>;
  warnOnPartialFirstPage?: boolean;
  allowPrivatePosts?: boolean;
  allowSquadPosts?: boolean;
  removeNonPublicThresholdSquads?: boolean;
};

export function feedResolver<
  TSource,
  TArgs extends Omit<FeedArgs, 'ranking'>,
  TPage extends Page,
  TParams,
>(
  query: (
    ctx: Context,
    args: TArgs,
    builder: SelectQueryBuilder<Post & { feedMeta?: string }>,
    alias: string,
    params?: TParams,
  ) => SelectQueryBuilder<Post & { feedMeta?: string }>,
  pageGenerator: PageGenerator<GQLPost, TArgs, TPage, TParams>,
  applyPaging: (
    ctx: Context,
    args: TArgs,
    page: TPage,
    builder: SelectQueryBuilder<Post & { feedMeta?: string }>,
    alias: string,
  ) => SelectQueryBuilder<Post & { feedMeta?: string }>,
  {
    removeHiddenPosts = true,
    removeBannedPosts = true,
    fetchQueryParams,
    warnOnPartialFirstPage = false,
    allowPrivatePosts = true,
    allowSquadPosts = true,
    removeNonPublicThresholdSquads = true,
  }: FeedResolverOptions<TArgs, TParams, TPage> = {},
): IFieldResolver<TSource, Context, TArgs> {
  return async (source, args, context, info): Promise<Connection<GQLPost>> => {
    const page = pageGenerator.connArgsToPage(args);
    const queryParams =
      fetchQueryParams &&
      (await runInSpan('feedResolver.fetchQueryParams', async () =>
        fetchQueryParams(context, args, page),
      ));
    const excludedTypes =
      queryParams && (queryParams as AnonymousFeedFilters).excludeTypes;

    const supportedTypes = args.supportedTypes?.filter((type) => {
      return excludedTypes ? !excludedTypes.includes(type) : true;
    });

    const excludeSourceTypes =
      queryParams && (queryParams as AnonymousFeedFilters).excludeSourceTypes;
    const sourceTypes =
      excludeSourceTypes && baseFeedConfig.source_types
        ? baseFeedConfig.source_types.filter(
            (el) => !excludeSourceTypes.includes(el),
          )
        : [];

    const result = await runInSpan('feedResolver.queryPaginated', async () =>
      graphorm.queryPaginated<GQLPost>(
        context,
        info,
        (nodeSize) =>
          pageGenerator.hasPreviousPage(page, nodeSize, undefined, queryParams),
        (nodeSize) =>
          pageGenerator.hasNextPage(page, nodeSize, undefined, queryParams),
        (node, index) =>
          pageGenerator.nodeToCursor(page, args, node, index, queryParams),
        (builder) => {
          builder.queryBuilder = applyFeedWhere(
            context,
            applyPaging(
              context,
              args,
              page,
              query(
                context,
                args,
                builder.queryBuilder,
                builder.alias,
                queryParams,
              ),
              builder.alias,
            ),
            builder.alias,
            supportedTypes || ['article'],
            removeHiddenPosts,
            removeBannedPosts,
            allowPrivatePosts,
            allowSquadPosts,
            removeNonPublicThresholdSquads,
            sourceTypes,
          );
          // console.log(builder.queryBuilder.getSql());
          return builder;
        },
        (nodes) =>
          pageGenerator.transformNodes?.(page, nodes, queryParams) ?? nodes,
        true,
      ),
    );
    // Sometimes the feed can have a bit less posts than requested due to recent ban or deletion
    if (
      warnOnPartialFirstPage &&
      !args.after &&
      result.edges.length < args.first! * 0.5
    ) {
      context.log.warn(
        {
          args,
          userId: context.userId || context.trackingId,
          loggedIn: !!context.userId,
          posts: result.edges.length,
        },
        `feed's first page is missing posts`,
      );
    }
    return result;
  };
}

export function randomPostsResolver<
  TSource,
  TArgs extends { first?: number | null },
>(
  query: (
    ctx: Context,
    args: TArgs,
    builder: SelectQueryBuilder<Post>,
    alias: string,
  ) => SelectQueryBuilder<Post>,
  defaultPageSize: number,
): IFieldResolver<TSource, Context, TArgs> {
  return async (source, args, context, info): Promise<GQLPost[]> => {
    const pageSize = args.first ?? defaultPageSize;
    return graphorm.query(context, info, (builder) => {
      builder.queryBuilder = applyFeedWhere(
        context,
        query(context, args, builder.queryBuilder, builder.alias),
        builder.alias,
        ['article'],
        true,
        true,
        false,
      )
        .orderBy('random()')
        .limit(pageSize);
      return builder;
    });
  };
}

/**
 * Feeds builders and resolvers
 */

export interface AnonymousFeedFilters {
  includeSources?: string[];
  excludeSources?: string[];
  excludeTypes?: string[];
  includeTags?: string[];
  blockedTags?: string[];
  sourceIds?: string[];
  blockedContentCuration?: string[];
  blockedWords?: string[];
  excludeSourceTypes?: string[];
  followingUsers?: string[];
  excludeUsers?: string[];
  followingSources?: string[];
  flags?: FeedFlagsFilters;
}

export const anonymousFeedBuilder = (
  ctx: Context,
  filters: AnonymousFeedFilters | undefined,
  builder: SelectQueryBuilder<Post>,
  alias: string,
): SelectQueryBuilder<Post> => {
  let newBuilder = builder;
  if (filters?.includeSources?.length) {
    newBuilder = newBuilder.andWhere(`${alias}."sourceId" IN (:...sources)`, {
      sources: filters.includeSources,
    });
  } else if (filters?.excludeSources?.length) {
    newBuilder = newBuilder.andWhere(
      `${alias}."sourceId" NOT IN (:...sources)`,
      {
        sources: filters.excludeSources,
      },
    );
  }

  if (filters?.includeTags?.length) {
    newBuilder = newBuilder.andWhere((builder) =>
      whereTags(filters.includeTags!, builder, alias),
    );
  }
  if (filters?.blockedTags?.length) {
    newBuilder = newBuilder.andWhere((builder) =>
      whereNotTags(filters.blockedTags!, builder, alias),
    );
  }
  return newBuilder;
};

export const configuredFeedBuilder = (
  ctx: Context,
  feedId: string | undefined,
  unreadOnly: boolean,
  builder: SelectQueryBuilder<Post>,
  alias: string,
  filters: AnonymousFeedFilters | undefined,
): SelectQueryBuilder<Post> => {
  let newBuilder = anonymousFeedBuilder(ctx, filters, builder, alias);
  if (unreadOnly) {
    newBuilder = newBuilder.andWhere((subBuilder) =>
      whereUnread(ctx.userId, subBuilder, alias),
    );
  }
  return newBuilder;
};

interface BookmarksFeedBuilderProps {
  ctx: Context;
  unreadOnly: boolean;
  reminderOnly: boolean;
  listId?: string | null;
  builder: SelectQueryBuilder<Post>;
  alias: string;
  query?: string | null;
}

export const bookmarksFeedBuilder = ({
  ctx,
  unreadOnly,
  reminderOnly,
  listId,
  builder,
  alias,
  query,
}: BookmarksFeedBuilderProps): SelectQueryBuilder<Post> => {
  let newBuilder = builder
    .addSelect('bookmark.createdAt', 'bookmarkedAt')
    .innerJoin(
      Bookmark,
      'bookmark',
      `bookmark."postId" = ${alias}.id AND bookmark."userId" = :userId`,
      { userId: ctx.userId },
    );

  if (unreadOnly) {
    newBuilder = newBuilder.andWhere((subBuilder) =>
      whereUnread(ctx.userId, subBuilder, alias),
    );
  }

  if (query) {
    return newBuilder.andWhere(
      `${alias}.tsv @@ (${getSearchQuery(':query')})`,
      {
        query: processSearchQuery(query),
      },
    );
  }

  if (reminderOnly) {
    return newBuilder.andWhere(`bookmark.remindAt IS NOT NULL`);
  }

  if (!ctx.isPlus) {
    // non-plus user don't have the ability to create/search in folders
    return newBuilder;
  }

  newBuilder = listId
    ? newBuilder.andWhere(`bookmark."listId" = :listId`, { listId })
    : newBuilder.andWhere('bookmark.listId IS NULL');

  return newBuilder;
};

export const sourceFeedBuilder = (
  ctx: Context,
  sourceId: string,
  builder: SelectQueryBuilder<Post>,
  alias: string,
): SelectQueryBuilder<Post> => {
  builder.andWhere(`${alias}.sourceId = :sourceId`, { sourceId });

  if (sourceId === 'community') {
    builder.andWhere(`${alias}.banned = false`);
  } else {
    builder.andWhere(
      new Brackets((qb) => {
        return qb
          .where(`${alias}.authorId = :userId OR ${alias}.scoutId = :userId`, {
            userId: ctx.userId,
          })
          .orWhere(whereVordrFilter(alias));
      }),
    );
  }

  return builder;
};

export const tagFeedBuilder = (
  ctx: Context,
  tag: string,
  builder: SelectQueryBuilder<Post>,
  alias: string,
): SelectQueryBuilder<Post> =>
  builder.andWhere((subBuilder) => whereTags([tag], subBuilder, alias));

export const fixedIdsFeedBuilder = (
  ctx: unknown,
  ids: string[],
  builder: SelectQueryBuilder<Post & { feedMeta?: string }>,
  alias: string,
): SelectQueryBuilder<Post & { feedMeta?: string }> => {
  // In case ids is empty make sure the query does not fail
  const idsStr = ids.length
    ? ids.map((id) => `'${id}'`).join(',')
    : `'nosuchid'`;
  return builder
    .andWhere(`${alias}.id IN (${idsStr})`)
    .orderBy(`array_position(array[${idsStr}], ${alias}.id)`);
};
