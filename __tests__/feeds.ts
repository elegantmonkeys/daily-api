import {
  createSquadWelcomePost,
  feedToFilters,
  maxFeedNameLength,
  Ranking,
  updateFlagsStatement,
} from '../src/common';
import {
  AdvancedSettings,
  ArticlePost,
  BookmarkList,
  Feed,
  FeedAdvancedSettings,
  FreeformPost,
  Keyword,
  MachineSource,
  Post,
  PostKeyword,
  PostTag,
  PostType,
  SharePost,
  Source,
  SourceType,
  User,
  UserPost,
  View,
  WelcomePost,
  YouTubePost,
} from '../src/entity';
import { SourceMemberRoles } from '../src/roles';
import { Category } from '../src/entity/Category';
import { FastifyInstance } from 'fastify';
import {
  feedFields,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  saveFixtures,
  testMutationError,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import { sourcesFixture } from './fixture/source';
import {
  postKeywordsFixture,
  postsFixture,
  postTagsFixture,
  sharedPostsFixture,
  videoPostsFixture,
  vordrPostsFixture,
} from './fixture/post';
import { keywordsFixture } from './fixture/keywords';
import nock from 'nock';
import { deleteKeysByPattern } from '../src/redis';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import { randomUUID } from 'crypto';
import { usersFixture } from './fixture/user';
import { base64 } from 'graphql-relay/utils/base64';
import { maxFeedsPerUser, UserVote } from '../src/types';
import { SubmissionFailErrorMessage } from '../src/errors';
import { baseFeedConfig } from '../src/integrations/feed';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceKeyword } from '../src/entity/contentPreference/ContentPreferenceKeyword';
import { ContentPreferenceWord } from '../src/entity/contentPreference/ContentPreferenceWord';

let app: FastifyInstance;
let con: DataSource;
let state: GraphQLTestingState;
let client: GraphQLTestClient;
let loggedUser: string = null;

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(
    () => new MockContext(con, loggedUser),
  );
  client = state.client;
  app = state.app;
});

beforeEach(async () => {
  loggedUser = null;

  await saveFixtures(con, User, usersFixture);
  await saveFixtures(con, AdvancedSettings, advancedSettings);
  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, ArticlePost, postsFixture);
  await saveFixtures(con, ArticlePost, sharedPostsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
  await saveFixtures(con, PostKeyword, postKeywordsFixture);
  await saveFixtures(con, Keyword, [
    ...keywordsFixture,
    { value: 'javascript', occurrences: 57, status: 'allow' },
    { value: 'html', status: 'allow' },
    { value: 'python', status: 'allow' },
    { value: 'java', status: 'allow' },
    { value: 'data', status: 'allow' },
  ]);
  await deleteKeysByPattern('feeds:*');
});

afterAll(() => app.close());

const advancedSettings: Partial<AdvancedSettings>[] = [
  {
    id: 1,
    title: 'Tech magazines',
    description: 'Description for Tech magazines',
    defaultEnabledState: true,
  },
  {
    id: 2,
    title: 'Non-editorial content',
    description: 'Description for Non-editorial content',
    defaultEnabledState: true,
  },
  {
    id: 3,
    title: 'Release notes',
    description: 'Description for Release notes',
    defaultEnabledState: true,
  },
  {
    id: 4,
    title: 'Code examples',
    description: 'Description for Code examples',
    defaultEnabledState: true,
  },
  {
    id: 5,
    title: 'Company blogs',
    description: 'Description for Company blogs',
    defaultEnabledState: true,
  },
  {
    id: 6,
    title: 'Another Settings',
    description: 'Description for Another Settings',
    defaultEnabledState: true,
  },
  {
    id: 7,
    title: 'Setting with options',
    description: 'Description for Another Settings',
    defaultEnabledState: true,
    group: 'content_types',
    options: {
      type: PostType.VideoYouTube,
    },
  },
];

const categories: Partial<Category>[] = [
  {
    id: 'FE',
    emoji: '🌈',
    title: 'Frontend',
    tags: ['html', 'javascript'],
  },
  {
    id: 'BE',
    emoji: '⚙️',
    title: 'Backend',
    tags: ['golang', 'javascript'],
  },
];

const saveFeedFixtures = async (): Promise<void> => {
  await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
  await saveFixtures(con, FeedAdvancedSettings, [
    { feedId: '1', advancedSettingsId: 1, enabled: true },
    { feedId: '1', advancedSettingsId: 2, enabled: false },
    { feedId: '1', advancedSettingsId: 3, enabled: false },
    { feedId: '1', advancedSettingsId: 4, enabled: true },
    { feedId: '1', advancedSettingsId: 7, enabled: true },
  ]);
  await saveFixtures(con, Category, categories);
  await saveFixtures(con, ContentPreferenceSource, [
    {
      feedId: '1',
      sourceId: 'b',
      userId: '1',
      referenceId: 'b',
      status: ContentPreferenceStatus.Blocked,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
    },
    {
      feedId: '1',
      sourceId: 'c',
      userId: '1',
      referenceId: 'c',
      status: ContentPreferenceStatus.Blocked,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
    },
  ]);
  await saveFixtures(con, ContentPreferenceKeyword, [
    {
      feedId: '1',
      keywordId: 'html',
      referenceId: 'html',
      status: ContentPreferenceStatus.Follow,
      type: ContentPreferenceType.Keyword,
      userId: '1',
    },
    {
      feedId: '1',
      keywordId: 'javascript',
      referenceId: 'javascript',
      status: ContentPreferenceStatus.Follow,
      type: ContentPreferenceType.Keyword,
      userId: '1',
    },
    {
      feedId: '1',
      keywordId: 'golang',
      referenceId: 'golang',
      status: ContentPreferenceStatus.Blocked,
      type: ContentPreferenceType.Keyword,
      userId: '1',
    },
  ]);
};

const saveAdvancedSettingsFiltersFixtures = async (): Promise<void> => {
  await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
  await saveFixtures(con, MachineSource, [
    {
      id: 'includedSource',
      name: 'IS',
      image: 'http://image.com/c',
      handle: 'includedSource',
    },
    {
      id: 'excludedSource',
      name: 'ES',
      image: 'http://image.com/c',
      handle: 'excludedSource',
    },
    {
      id: 'settingsCombinationSource',
      name: 'SCS',
      image: 'http://image.com/c',
      handle: 'settingsCombinationSource',
    },
    {
      id: 'experimentExcludedSource',
      name: 'ExES',
      image: 'http://image.com/c',
      handle: 'experimentExcludedSource',
    },
    {
      id: 'experimentIncludedSource',
      name: 'ExIS',
      image: 'http://image.com/c',
      handle: 'experimentIncludedSource',
    },
  ]);
  await saveFixtures(con, ArticlePost, [
    {
      id: 'includedPost',
      shortId: 'ip1',
      title: 'Included Post',
      url: 'http://ip1.com',
      score: 0,
      sourceId: 'includedSource',
      tagsStr: 'javascript,webdev',
    },
    {
      id: 'excludedPost',
      shortId: 'ep1',
      title: 'Excluded Post',
      url: 'http://ip2.com',
      score: 0,
      sourceId: 'excludedSource',
      tagsStr: 'javascript,webdev',
    },
    {
      id: 'excludedPostAgain',
      shortId: 'epa1',
      title: 'This should be excluded as well',
      url: 'http://ip3.com',
      score: 0,
      sourceId: 'settingsCombinationSource',
      tagsStr: 'javascript,webdev',
    },
  ] as ArticlePost[]);
  await saveFixtures(con, SharePost, [
    {
      id: 'sourcePost',
      shortId: 'nsp1',
      title: 'Source Post',
      score: 0,
      sourceId: 'p',
      tagsStr: 'javascript,webdev',
    },
  ] as SharePost[]);
  await saveFixtures(con, FeedAdvancedSettings, [
    { feedId: '1', advancedSettingsId: 1, enabled: false },
    { feedId: '1', advancedSettingsId: 2, enabled: true },
    { feedId: '1', advancedSettingsId: 3, enabled: true },
    { feedId: '1', advancedSettingsId: 4, enabled: false },
    { feedId: '1', advancedSettingsId: 7, enabled: false },
  ]);
};

describe('query anonymousFeed', () => {
  const variables = {
    ranking: Ranking.POPULARITY,
    first: 10,
  };

  const QUERY = `
  query AnonymousFeed($filters: FiltersInput, $ranking: Ranking, $first: Int, $version: Int) {
    anonymousFeed(filters: $filters, ranking: $ranking, first: $first, version: $version) {
      ${feedFields()}
    }
  }
`;

  it('should return anonymous feed with no filters ordered by popularity', async () => {
    await con.getRepository(Post).delete({ id: 'p6' });
    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed with no filters ordered by time', async () => {
    const res = await client.query(QUERY, {
      variables: { ...variables, ranking: Ranking.TIME },
    });
    delete res.data.anonymousFeed.pageInfo.endCursor;
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by sources', async () => {
    const res = await client.query(QUERY, {
      variables: { ...variables, filters: { includeSources: ['a', 'b'] } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by tags', async () => {
    const res = await client.query(QUERY, {
      variables: { ...variables, filters: { includeTags: ['html', 'webdev'] } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed while excluding sources', async () => {
    await con.getRepository(Post).delete({ id: 'p6' });
    const res = await client.query(QUERY, {
      variables: { ...variables, filters: { excludeSources: ['a'] } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return feed while excluding sources based on advanced settings', async () => {
    await con.getRepository(Post).delete({ id: 'p6' });
    await saveAdvancedSettingsFiltersFixtures();
    await con.getRepository(ContentPreferenceSource).save([
      {
        feedId: '1',
        sourceId: 'excludedSource',
        userId: '1',
        referenceId: 'excludedSource',
        status: ContentPreferenceStatus.Blocked,
      },
      {
        feedId: '1',
        sourceId: 'settingsCombinationSource',
        userId: '1',
        referenceId: 'settingsCombinationSource',
        status: ContentPreferenceStatus.Blocked,
      },
    ]);

    const filters = await feedToFilters(con, '1', '1');
    delete filters.sourceIds;
    delete filters.excludeTypes;
    const res = await client.query(QUERY, {
      variables: { ...variables, filters },
    });
    expect(
      res.data.anonymousFeed.edges.map(({ node }) => node.id),
    ).toIncludeSameMembers(['p5', 'p2', 'p3', 'p4', 'p1', 'includedPost']);
  });

  it('should return anonymous feed filtered by tags and sources', async () => {
    const res = await client.query(QUERY, {
      variables: {
        ...variables,
        filters: {
          includeTags: ['javascript'],
          includeSources: ['a', 'b'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should remove banned posts from the feed', async () => {
    await con.getRepository(Post).delete({ id: 'p6' });
    await con.getRepository(Post).update({ id: 'p5' }, { banned: true });

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should remove posts with "showOnFeed" false', async () => {
    await con.getRepository(Post).delete({ id: 'p6' });
    await con.getRepository(Post).update({ id: 'p5' }, { showOnFeed: false });

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed v2', async () => {
    loggedUser = '1';

    nock('http://localhost:6000')
      .post('/popular', {
        total_pages: 1,
        page_size: 10,
        fresh_page_size: '4',
        offset: 0,
        user_id: '1',
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 2 },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should safetly handle a case where the feed is empty', async () => {
    loggedUser = '1';
    nock('http://localhost:6000').post('/popular').reply(200, {
      data: [],
    });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 2 },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed v2 and include blocked filters', async () => {
    loggedUser = '1';
    await con.getRepository(Feed).save({ id: '1', userId: '1' });
    await con.getRepository(ContentPreferenceKeyword).save([
      {
        feedId: '1',
        keywordId: 'javascript',
        referenceId: 'javascript',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        feedId: '1',
        keywordId: 'golang',
        referenceId: 'golang',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        feedId: '1',
        keywordId: 'python',
        referenceId: 'python',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        feedId: '1',
        keywordId: 'java',
        referenceId: 'java',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);
    await con.getRepository(ContentPreferenceSource).save([
      {
        feedId: '1',
        sourceId: 'a',
        userId: '1',
        referenceId: 'a',
        status: ContentPreferenceStatus.Blocked,
      },
      {
        feedId: '1',
        sourceId: 'b',
        userId: '1',
        referenceId: 'b',
        status: ContentPreferenceStatus.Blocked,
      },
    ]);

    nock('http://localhost:6000')
      .post('/popular', {
        total_pages: 1,
        page_size: 10,
        fresh_page_size: '4',
        offset: 0,
        blocked_tags: ['python', 'java'],
        blocked_sources: ['a', 'b'],
        user_id: '1',
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 2 },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query anonymousFeed by time', () => {
  const variables = {
    ranking: Ranking.TIME,
    first: 10,
  };

  const QUERY = `
  query AnonymousFeed($filters: FiltersInput, $ranking: Ranking, $first: Int, $version: Int) {
    anonymousFeed(filters: $filters, ranking: $ranking, first: $first, version: $version) {
      ${feedFields()}
    }
  }
`;

  it('should return anonymous feed with no filters ordered by time', async () => {
    await con.getRepository(Post).delete({ id: 'p6' });
    const res = await client.query(QUERY, {
      variables: { ...variables },
    });
    delete res.data.anonymousFeed.pageInfo.endCursor;
    expect(res.data).toMatchSnapshot();
  });

  it('should not include posts from squads that pass public threshold', async () => {
    await con.getRepository(Post).update({ id: 'yt2' }, { private: false });
    await con.getRepository(Source).update(
      { id: 'squad' },
      {
        private: false,
      },
    );
    const res = await client.query(QUERY, {
      variables: { ...variables },
    });
    delete res.data.anonymousFeed.pageInfo.endCursor;
    const ids = res.data.anonymousFeed.edges.map((edge) => edge.node.id);
    expect(ids).not.toIncludeAllMembers(['yt2']);
  });

  it('should include posts from squads that pass public threshold', async () => {
    await con.getRepository(Post).update({ id: 'yt2' }, { private: false });
    await con.getRepository(Source).update(
      { id: 'squad' },
      {
        private: false,
        flags: updateFlagsStatement<Source>({ publicThreshold: true }),
      },
    );
    const res = await client.query(QUERY, {
      variables: { ...variables },
    });
    delete res.data.anonymousFeed.pageInfo.endCursor;
    const ids = res.data.anonymousFeed.edges.map((edge) => edge.node.id);
    expect(ids).toIncludeAllMembers(['yt2']);
  });
});

describe('query feed', () => {
  const variables = {
    ranking: Ranking.POPULARITY,
    first: 10,
  };

  const QUERY = `
  query Feed($ranking: Ranking, $first: Int, $after: String, $version: Int, $unreadOnly: Boolean, $supportedTypes: [String!]) {
    feed(ranking: $ranking, first: $first, after: $after, version: $version, unreadOnly: $unreadOnly, supportedTypes: $supportedTypes) {
      ${feedFields()}
    }
  }
`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(client, { query: QUERY, variables }, 'UNAUTHENTICATED'));

  it('should return feed with preconfigured filters', async () => {
    loggedUser = '1';
    await saveFeedFixtures();

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  describe('youtube content', () => {
    beforeEach(async () => {
      await saveFixtures(con, YouTubePost, videoPostsFixture);
      await saveFeedFixtures();
      await con.getRepository(PostKeyword).save([
        { keyword: 'backend', postId: videoPostsFixture[0].id },
        { keyword: 'javascript', postId: videoPostsFixture[0].id },
      ]);
    });

    it('should include video content by default', async () => {
      loggedUser = '1';

      await con.getRepository(FeedAdvancedSettings).delete({
        feedId: '1',
        advancedSettingsId: 7,
      });

      const res = await client.query(QUERY, {
        variables: {
          ...variables,
          supportedTypes: ['article', 'video:youtube'],
        },
      });
      expect(res.data).toMatchSnapshot();
      res.data.feed.edges.map((post) => {
        expect(
          ['article', 'video:youtube'].includes(post.node.type),
        ).toBeTruthy();
      });
    });

    it('should include video content when it is enabled by the user', async () => {
      loggedUser = '1';

      const res = await client.query(QUERY, {
        variables: {
          ...variables,
          supportedTypes: ['article', 'video:youtube'],
        },
      });
      expect(res.data).toMatchSnapshot();
      res.data.feed.edges.map((post) => {
        expect(
          ['article', 'video:youtube'].includes(post.node.type),
        ).toBeTruthy();
      });
    });

    it('should exclude video content when it is disabled by the user', async () => {
      loggedUser = '1';

      await saveFixtures(con, FeedAdvancedSettings, [
        { feedId: '1', advancedSettingsId: 7, enabled: false },
      ]);

      const res = await client.query(QUERY, {
        variables: {
          ...variables,
          supportedTypes: ['article', 'video:youtube'],
        },
      });
      expect(res.data).toMatchSnapshot();

      res.data.feed.edges.map((post) => {
        expect(post.node.type).not.toEqual('video:youtube');
      });
    });

    it('can filter out article posts', async () => {
      loggedUser = '1';

      await saveFixtures(con, FeedAdvancedSettings, [
        { feedId: '1', advancedSettingsId: 7, enabled: false },
      ]);
      await con.getRepository(AdvancedSettings).update(
        { id: 7 },
        {
          options: {
            type: PostType.Article,
          },
        },
      );

      const res = await client.query(QUERY, {
        variables: {
          ...variables,
          supportedTypes: ['article', 'video:youtube'],
        },
      });
      expect(res.data).toMatchSnapshot();

      res.data.feed.edges.map((post) => {
        expect(post.node.type).not.toEqual('article');
      });
    });
  });

  it('should return preconfigured feed with tags filters only', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, ContentPreferenceKeyword, [
      {
        feedId: '1',
        keywordId: 'html',
        referenceId: 'html',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with blocked tags filters only', async () => {
    loggedUser = '1';
    await con.getRepository(Post).delete({ id: 'p6' });
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, ContentPreferenceKeyword, [
      {
        feedId: '1',
        keywordId: 'html',
        referenceId: 'html',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with tags and blocked tags filters', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, ContentPreferenceKeyword, [
      {
        feedId: '1',
        keywordId: 'javascript',
        referenceId: 'javascript',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        feedId: '1',
        keywordId: 'webdev',
        referenceId: 'webdev',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with sources filters only', async () => {
    loggedUser = '1';
    await con.getRepository(Post).delete({ id: 'p6' });
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, ContentPreferenceSource, [
      {
        feedId: '1',
        sourceId: 'a',
        userId: '1',
        referenceId: 'a',
        status: ContentPreferenceStatus.Blocked,
      },
    ]);

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with sources filtered based on advanced settings', async () => {
    loggedUser = '1';
    const repo = con.getRepository(Post);
    await repo.delete({ id: 'p6' });
    await saveAdvancedSettingsFiltersFixtures();
    await con.getRepository(ContentPreferenceSource).save([
      {
        feedId: '1',
        sourceId: 'excludedSource',
        userId: '1',
        referenceId: 'excludedSource',
        status: ContentPreferenceStatus.Blocked,
      },
      {
        feedId: '1',
        sourceId: 'settingsCombinationSource',
        userId: '1',
        referenceId: 'settingsCombinationSource',
        status: ContentPreferenceStatus.Blocked,
      },
    ]);
    await repo.update({ id: 'p1' }, { score: 2 });
    await repo.update({ id: 'includedPost' }, { score: 1 });

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with no filters', async () => {
    loggedUser = '1';
    await con.getRepository(Post).delete({ id: 'p6' });
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);

    const res = await client.query(QUERY, { variables });
    expect(res.data).toMatchSnapshot();
  });

  it('should return unread posts from preconfigured feed', async () => {
    loggedUser = '1';
    await con.getRepository(Post).delete({ id: 'p6' });
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con.getRepository(View).save([{ userId: '1', postId: 'p1' }]);

    const res = await client.query(QUERY, {
      variables: { ...variables, unreadOnly: true },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should remove banned posts from the feed', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await con.getRepository(Post).update({ id: 'p4' }, { banned: true });

    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should remove deleted posts from the feed', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await con.getRepository(Post).update({ id: 'p4' }, { deleted: true });

    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should return feed with proper config', async () => {
    loggedUser = '1';
    nock('http://localhost:6002')
      .post('/config')
      .reply(200, {
        config: {
          providers: {},
        },
      });
    nock('http://localhost:6000')
      .post('/feed.json', {
        total_pages: 1,
        page_size: 10,
        offset: 0,
        fresh_page_size: '4',
        user_id: '1',
        ...baseFeedConfig,
        config: {
          providers: {},
        },
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
      });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 15 },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.feed.edges.length).toEqual(2);
  });

  it('should support feed service side caching', async () => {
    loggedUser = '1';
    nock('http://localhost:6002')
      .post('/config')
      .reply(200, {
        user_id: '1',
        config: {
          providers: {},
        },
      });
    nock('http://localhost:6000')
      .post('/feed.json', (body) => body.cursor === 'a')
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 20, after: 'a' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.feed.edges.length).toEqual(2);
    expect(res.data.feed.pageInfo.endCursor).toEqual('b');
  });

  it('should provide feed service with supported types', async () => {
    loggedUser = '1';
    nock('http://localhost:6002')
      .post('/config')
      .reply(200, {
        user_id: '1',
        config: {
          providers: {},
        },
      });
    nock('http://localhost:6000')
      .post('/feed.json', (body) => {
        expect(body.allowed_post_types).toEqual(['article']);
        return true;
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 20, supportedTypes: ['article'] },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.feed.edges.length).toEqual(2);
  });

  it('should exclude types based on feed settings', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await saveFixtures(con, FeedAdvancedSettings, [
      { feedId: '1', advancedSettingsId: 7, enabled: false },
    ]);
    nock('http://localhost:6002')
      .post('/config')
      .reply(200, {
        user_id: '1',
        config: {
          providers: {},
        },
      });
    nock('http://localhost:6000')
      .post('/feed.json', (body) => {
        expect(body.allowed_post_types).toEqual(['article', 'collections']);
        return true;
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: {
        ...variables,
        version: 20,
        supportedTypes: ['article', 'video:youtube', 'collections'],
      },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.feed.edges.length).toEqual(2);
  });

  it('should support squad posts', async () => {
    loggedUser = '1';
    nock('http://localhost:6002')
      .post('/config')
      .reply(200, {
        user_id: '1',
        config: {
          providers: {},
        },
      });
    nock('http://localhost:6000')
      .post('/feed.json')
      .reply(200, {
        data: [{ post_id: 'yt2' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: { ...variables, version: 20 },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.feed.edges.length).toEqual(1);
  });

  it('should return only article posts by default', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await con
      .getRepository(Post)
      .update({ id: 'p4' }, { type: PostType.Share });

    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should respect the supportedTypes argument', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await con
      .getRepository(Post)
      .update({ id: 'p4' }, { type: PostType.Share });

    const res = await client.query(QUERY, {
      variables: { supportedTypes: ['article', 'share'] },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query feedByConfig', () => {
  const variables = {
    first: 10,
    config: JSON.stringify({ key: 'value' }),
  };

  const QUERY = `
  query FeedByConfig($first: Int, $config: String!) {
    feedByConfig(first: $first, config: $config) {
      ${feedFields()}
    }
  }
`;

  it('should not authorize when private routes are not enabled', async () => {
    process.env.ENABLE_PRIVATE_ROUTES = 'false';
    await testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables,
      },
      'UNAUTHENTICATED',
    );
    process.env.ENABLE_PRIVATE_ROUTES = 'true';
  });

  it('should send provided config to feed service', async () => {
    nock('http://localhost:6000')
      .post('/feed.json', {
        key: 'value',
        total_pages: 1,
        page_size: 10,
        fresh_page_size: '4',
        offset: 0,
      })
      .reply(200, {
        data: [{ post_id: 'p1' }],
      });

    const res = await client.query(QUERY, { variables });
    expect(res.errors).toBeFalsy();
    expect(res.data.feedByConfig.edges[0].node.id).toEqual('p1');
  });
});

describe('query feedByIds', () => {
  const QUERY = `
  query FeedByIds($first: Int, $postIds: [String!]!) {
    feedByIds(first: $first, postIds: $postIds) {
      ${feedFields()}
    }
  }
`;

  it('should not authorize when no user is set', async () => {
    await testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { first: 10, postIds: ['p1', 'p2'] },
      },
      'UNAUTHENTICATED',
    );
  });

  it('should not authorize when no user is not team member', async () => {
    loggedUser = '1';
    await testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { first: 10, postIds: ['p1', 'p2'] },
      },
      'FORBIDDEN',
    );
  });

  it('should return feed by ids for team member', async () => {
    loggedUser = '1';
    state = await initializeGraphQLTesting(
      (req) => new MockContext(con, loggedUser, false, [], req, true),
    );

    const res = await state.client.query(QUERY, {
      variables: { first: 10, postIds: ['p3', 'p2', 'p1'] },
    });
    const ids = res.data.feedByIds.edges.map(({ node }) => node.id);
    expect(ids).toEqual(['p3', 'p2', 'p1']);
  });
});

describe('query sourceFeed', () => {
  let additionalProps = '';
  const QUERY = (
    source: string,
    ranking: Ranking = Ranking.POPULARITY,
    now = new Date(),
    first = 10,
    after = '',
  ): string => `{
    sourceFeed(source: "${source}", ranking: ${ranking}, now: "${now.toISOString()}", first: ${first}, supportedTypes: ["article", "share", "welcome", "freeform"], after: "${after}") {
      ${feedFields(`pinnedAt ${additionalProps}`)}
    }
  }`;

  beforeEach(() => {
    additionalProps = '';
  });

  it('should return a single source feed', async () => {
    const res = await client.query(QUERY('b'));
    res.data.sourceFeed.edges.forEach(({ node }) =>
      expect(node.source.id).toEqual('b'),
    );
  });

  it('should display a banned post in source feed', async () => {
    await con.getRepository(Post).update({ id: 'p5' }, { banned: true });
    const res = await client.query(QUERY('b'));
    expect(
      res.data.sourceFeed.edges.some(({ node }) => node.id === 'p5'),
    ).toBeTruthy();
  });

  it('should display a welcome post first in source feed', async () => {
    const createdAt = new Date('2020-09-21T07:15:51.247Z');
    await con.getRepository(Post).update({ id: 'p5' }, { createdAt });
    const res1 = await client.query(QUERY('b', Ranking.TIME));
    expect(res1.data.sourceFeed.edges[0].node.id).not.toEqual('p5');

    const repo = con.getRepository(Source);
    await repo.update({ id: 'b' }, { type: SourceType.Squad });
    const source = await repo.findOneBy({ id: 'b' });

    await con.getRepository(User).save(usersFixture[0]);
    const post = await createSquadWelcomePost(con, source, '1', {
      createdAt: new Date(),
    });
    const res2 = await client.query(QUERY('b', Ranking.TIME));
    expect(res2.data.sourceFeed.edges[0].node.id).toEqual(post.id);
    expect(res2.data.sourceFeed.edges.length).toBeGreaterThan(1);
  });

  it('should display return the right posts after the first page being pinned posts', async () => {
    await con.getRepository(User).save({ id: '1', name: 'Lee' });
    const createdAt1 = new Date('2020-09-21T01:15:51.247Z');
    const createdAt2 = new Date('2020-09-21T02:15:51.247Z');
    const createdAt3 = new Date('2020-09-21T03:15:51.247Z');
    const createdAt4 = new Date('2020-09-21T04:15:51.247Z');
    const createdAt5 = new Date('2020-09-21T05:15:51.247Z');
    const repo = con.getRepository(Source);
    await repo.update({ id: 'b' }, { type: SourceType.Squad });
    const source = await repo.findOneBy({ id: 'b' });
    // used welcome post as a sample of pinned posts
    const pin = await createSquadWelcomePost(con, source, '1', {
      createdAt: createdAt1,
    });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt2 });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt3 });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt4 });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt5 });
    await con
      .getRepository(Post)
      .update({ id: 'p5' }, { createdAt: new Date() });

    const unbased = base64(
      `time:${createdAt1.getTime()};pinned:${pin.pinnedAt.getTime()}`,
    );
    const query = QUERY('b', Ranking.TIME, new Date(), 5, unbased);
    const res = await client.query(query);

    expect(res.data.sourceFeed.edges[0].node.id).toEqual('p5');
    expect(res.data.sourceFeed.edges).toMatchSnapshot();
  });

  it('should display return the right posts after the first page being a mix of pinned and unpinned posts', async () => {
    await con.getRepository(User).save({ id: '1', name: 'Lee' });
    const createdAt1 = new Date('2020-09-21T01:15:51.247Z');
    const createdAt2 = new Date('2020-09-21T02:15:51.247Z');
    const createdAt3 = new Date('2020-09-21T03:15:51.247Z');
    const createdAt4 = new Date('2020-09-21T04:15:51.247Z');
    const repo = con.getRepository(Source);
    await repo.update({ id: 'b' }, { type: SourceType.Squad });
    const source = await repo.findOneBy({ id: 'b' });
    // used welcome post as a sample of pinned posts
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt1 });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt2 });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt3 });
    await createSquadWelcomePost(con, source, '1', { createdAt: createdAt4 });
    await con
      .getRepository(Post)
      .update({ id: 'p5' }, { createdAt: new Date() });
    const post = await con.getRepository(Post).findOneBy({ id: 'p5' });
    const unbased = base64(`time:${post.createdAt.getTime()}`);
    const query = QUERY('b', Ranking.TIME, new Date(), 5, unbased);
    const res = await client.query(query);

    expect(res.data.sourceFeed.edges[0].node.id).toEqual('p2');
    expect(res.data.sourceFeed.edges).toMatchSnapshot();
  });

  it('should not display a banned post for community source', async () => {
    await con
      .getRepository(Post)
      .update({ id: 'p6' }, { sourceId: 'community' });
    await con
      .getRepository(Post)
      .update({ id: 'p5' }, { banned: true, sourceId: 'community' });
    const res = await client.query(QUERY('community'));
    expect(
      res.data.sourceFeed.edges.every(({ node }) => node.id !== 'p5'),
    ).toBeTruthy();
  });

  it('should throw an error when accessing private source', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(client, { query: QUERY('a') }, 'FORBIDDEN');
  });

  it('should return a private source feed when user is a member', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'b' }, { private: true });
    await con.getRepository(User).save(usersFixture[0]);
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'b',
        referenceId: 'b',
        userId: '1',
        createdAt: new Date(2022, 11, 19),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: randomUUID(),
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    const res = await client.query(QUERY('b'));
    res.data.sourceFeed.edges.forEach(({ node }) =>
      expect(node.source.id).toEqual('b'),
    );
  });

  it('should return a freeform or welcome post without image', async () => {
    loggedUser = '1';
    additionalProps = 'type image';
    await con.getRepository(User).save(usersFixture[0]);
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    const repo = con.getRepository(Source);
    await repo.update({ id: 'b' }, { private: true });
    const source = await repo.findOneBy({ id: 'b' });
    const welcome = await createSquadWelcomePost(con, source, '1');
    const freeform = await createSquadWelcomePost(con, source, '1');
    await con
      .getRepository(Post)
      .update({ id: freeform.id }, { type: PostType.Freeform });
    await con
      .getRepository(FreeformPost)
      .update({ id: freeform.id }, { image: null });
    await con
      .getRepository(WelcomePost)
      .update({ id: welcome.id }, { image: null });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'b',
        referenceId: 'b',
        userId: '1',
        createdAt: new Date(2022, 11, 19),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: randomUUID(),
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);

    const res = await client.query(QUERY('b'));
    const edges = res.data?.sourceFeed?.edges;
    edges.forEach(({ node }) => expect(node.source.id).toEqual('b'));
    const welcomePost = edges.find(
      ({ node }) => node.type === PostType.Welcome,
    );
    expect(welcomePost.node.image).toBeNull();
    const freeformPost = edges.find(
      ({ node }) => node.type === PostType.Freeform,
    );
    expect(freeformPost.node.image).toBeNull();
  });

  it('should disallow access to feed for public source for blocked members', async () => {
    loggedUser = '1';
    await con.getRepository(User).save(usersFixture[0]);
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: false });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Blocked,
        referralToken: 'rt2',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });

    return testQueryErrorCode(
      client,
      {
        query: QUERY('a'),
      },
      'FORBIDDEN',
    );
  });

  describe('vordr', () => {
    beforeEach(async () => {
      await saveFixtures(con, ArticlePost, vordrPostsFixture);
    });
    it('should filter out posts that vordr has prevented', async () => {
      loggedUser = '1';

      const res = await client.query(QUERY('b'));

      expect(res.data.sourceFeed.edges.length).toBe(2);
    });

    it('should not filter out posts that vordr has prevented when author is viewer', async () => {
      loggedUser = '2';

      const res = await client.query(QUERY('b'));

      expect(res.data.sourceFeed.edges.length).toBe(4);
    });
  });
});

describe('query tagFeed', () => {
  const QUERY = (
    tag: string,
    ranking: Ranking = Ranking.POPULARITY,
    now = new Date(),
    first = 10,
  ): string => `{
    tagFeed(tag: "${tag}", ranking: ${ranking}, now: "${now.toISOString()}", first: ${first}) {
      ${feedFields()}
    }
  }`;

  it('should return a single tag feed', async () => {
    const res = await client.query(QUERY('javascript'));
    expect(res.data).toMatchSnapshot();
  });
});

describe('query keywordFeed', () => {
  const QUERY = (
    keyword: string,
    ranking: Ranking = Ranking.POPULARITY,
    first = 10,
  ): string => `{
    keywordFeed(keyword: "${keyword}", ranking: ${ranking}, first: ${first}) {
      ${feedFields()}
    }
  }`;

  it('should return a single keyword feed', async () => {
    const res = await client.query(QUERY('javascript'));
    expect(res.data).toMatchSnapshot();
  });
});

describe('query feedSettings', () => {
  const QUERY = `query FeedSettings($feedId: ID) {
    feedSettings(feedId: $feedId) {
      id
      userId
      includeTags
      blockedTags
      includeSources {
        id
        name
        image
        public
      }
      excludeSources {
        id
        name
        image
        public
      }
      advancedSettings {
        id
        enabled
        advancedSettings {
          id
          title
          description
          group
        }
      }
    }
  }`;
  const ADD_FILTERS_MUTATION = `
  mutation AddFiltersToFeed($feedId: ID, $filters: FiltersInput!) {
    addFiltersToFeed(feedId: $feedId, filters: $filters) {
      id
      userId
      includeTags
      blockedTags
      includeSources {
        id
        name
        image
        public
      }
      excludeSources {
        id
        name
        image
        public
      }
      advancedSettings {
        id
        enabled
      }
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return the feed settings', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });

  it('should return the feed settings for custom feed when feedId is provided', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await saveFixtures(con, Feed, [{ id: 'cf2', userId: '1' }]);
    await client.mutate(ADD_FILTERS_MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['javascript'],
          includeSources: ['a'],
          excludeSources: ['b'],
          blockedTags: ['golang'],
        },
      },
    });

    const res = await client.query(QUERY, { variables: { feedId: 'cf2' } });
    expect(res.data.feedSettings).toMatchObject({
      includeTags: ['javascript'],
      includeSources: [
        {
          id: 'a',
          image: 'http://image.com/a',
          name: 'A',
          public: true,
        },
      ],
      excludeSources: [
        {
          id: 'b',
          image: 'http://image.com/b',
          name: 'B',
          public: true,
        },
      ],
      blockedTags: ['golang'],
    });
  });

  it('should remove blocked source from feed settings if followed', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await saveFixtures(con, Feed, [{ id: 'cf2', userId: '1' }]);
    // add blocked source
    await client.mutate(ADD_FILTERS_MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['javascript'],
          excludeSources: ['b'],
          blockedTags: ['golang'],
        },
      },
    });

    // blocked should be present
    const res = await client.query(QUERY, { variables: { feedId: 'cf2' } });
    expect(res.data.feedSettings).toMatchObject({
      includeTags: ['javascript'],
      includeSources: [],
      excludeSources: [
        {
          id: 'b',
          image: 'http://image.com/b',
          name: 'B',
          public: true,
        },
      ],
      blockedTags: ['golang'],
    });

    // follow the blocked source
    await client.mutate(ADD_FILTERS_MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeSources: ['b'],
        },
      },
    });

    // blocked should be removed
    const res2 = await client.query(QUERY, { variables: { feedId: 'cf2' } });
    expect(res2.data.feedSettings).toMatchObject({
      includeTags: ['javascript'],
      includeSources: [
        {
          id: 'b',
          image: 'http://image.com/b',
          name: 'B',
          public: true,
        },
      ],
      excludeSources: [],
      blockedTags: ['golang'],
    });
  });

  it('should return empty settings when feed not found for user', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await saveFixtures(con, Feed, [{ id: 'cf2', userId: '1' }]);
    await client.mutate(ADD_FILTERS_MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['javascript'],
          excludeSources: ['b'],
          blockedTags: ['golang'],
        },
      },
    });

    loggedUser = '2';

    const res = await client.query(QUERY, { variables: { feedId: 'cf2' } });
    expect(res.data.feedSettings).toMatchObject({
      includeTags: [],
      excludeSources: [],
      blockedTags: [],
    });
  });
});

describe('query rssFeeds', () => {
  const QUERY = `{
    rssFeeds {
      name, url
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return rss feeds', async () => {
    loggedUser = '1';
    const list = await con
      .getRepository(BookmarkList)
      .save({ userId: loggedUser, name: 'list' });
    const res = await client.query(QUERY);
    expect(res.data.rssFeeds).toEqual([
      { name: 'Recent news feed', url: 'http://localhost:4000/rss/f/1' },
      { name: 'Bookmarks', url: 'http://localhost:4000/rss/b/1' },
      {
        name: 'list',
        url: `http://localhost:4000/rss/b/l/${list.id.replace(/-/g, '')}`,
      },
    ]);
  });
});

describe('query authorFeed', () => {
  const QUERY = (
    author: string,
    ranking: Ranking = Ranking.POPULARITY,
    first = 10,
  ): string => `{
    authorFeed(author: "${author}", ranking: ${ranking}, first: ${first}) {
      ${feedFields(`
      isAuthor
      isScout
      `)}
    }
  }`;

  it('should return a single author feed with scout and author setting', async () => {
    await con.getRepository(User).save([
      {
        id: '1',
        name: 'Ido',
        image: 'https://daily.dev/ido.jpg',
        twitter: 'idoshamun',
      },
    ]);
    await con.getRepository(Post).update({ id: 'p1' }, { authorId: '1' });
    await con.getRepository(Post).update({ id: 'p3' }, { scoutId: '1' });

    const res = await client.query(QUERY('1'));
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });
});

describe('query mostUpvotedFeed', () => {
  const QUERY = (period = 7, first = 10, source = '', tag = ''): string => `{
    mostUpvotedFeed(first: ${first}, period: ${period}, source: "${source}", tag: "${tag}") {
      ${feedFields()}
    }
  }`;

  it('should return a most upvoted feed', async () => {
    const repo = con.getRepository(Post);
    const now = new Date();
    await repo.update({ id: 'p1' }, { upvotes: 20 });
    await repo.update({ id: 'p3' }, { upvotes: 15 });
    await repo.update(
      { id: 'p2' },
      {
        upvotes: 30,
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10),
      },
    );

    const res = await client.query(QUERY());
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return a most upvoted feed of the month', async () => {
    const repo = con.getRepository(Post);
    const now = new Date();
    await repo.update({ id: 'p1' }, { upvotes: 20 });
    await repo.update({ id: 'p3' }, { upvotes: 15 });
    await repo.update(
      { id: 'p2' },
      {
        upvotes: 30,
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10),
      },
    );

    const res = await client.query(QUERY(30));
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should not return posts from private squads', async () => {
    const sourceRepo = con.getRepository(Source);
    await sourceRepo.update({ id: 'squad' }, { type: SourceType.Squad });
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { upvotes: 20 });
    await repo.update({ id: 'p3' }, { upvotes: 15 });
    await repo.update({ id: 'p2' }, { upvotes: 30, sourceId: 'squad' });

    const res = await client.query(QUERY(30));
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should not return posts from public squads', async () => {
    const sourceRepo = con.getRepository(Source);
    await sourceRepo.update(
      { id: 'squad' },
      { type: SourceType.Squad, private: false },
    );
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { upvotes: 20 });
    await repo.update({ id: 'p3' }, { upvotes: 15 });
    await repo.update({ id: 'p2' }, { upvotes: 30, sourceId: 'squad' });

    const res = await client.query(QUERY(30));
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return posts from provided source', async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { upvotes: 20 });
    await repo.update({ id: 'p3' }, { upvotes: 15 });
    await repo.update({ id: 'p4' }, { upvotes: 30 });

    const res = await client.query(QUERY(30, 10, 'a'));
    expect(res.errors).toBeFalsy();
    expect(res.data.mostUpvotedFeed.edges.length).toEqual(2);
    res.data.mostUpvotedFeed.edges.forEach(({ node }) => {
      expect(node.source.id).toEqual('a');
    });
  });

  it('should return posts from provided tag', async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { upvotes: 20 });
    await repo.update({ id: 'p3' }, { upvotes: 15 });
    await repo.update({ id: 'p4' }, { upvotes: 30 });

    const res = await client.query(QUERY(30, 10, '', 'javascript'));
    expect(res.errors).toBeFalsy();
    expect(res.data.mostUpvotedFeed.edges.length).toEqual(2);
    res.data.mostUpvotedFeed.edges.forEach(({ node }) => {
      expect(node.tags).toContain('javascript');
    });
  });
});

describe('query mostDiscussedFeed', () => {
  const QUERY = (first = 10, source = '', tag = ''): string => `{
    mostDiscussedFeed(first: ${first}, source: "${source}", tag: "${tag}") {
      ${feedFields()}
    }
  }`;

  it('should return a most discussed feed', async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { comments: 5 });
    await repo.update({ id: 'p3' }, { comments: 2 });

    const res = await client.query(QUERY());
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should not return posts from private squads', async () => {
    await con
      .getRepository(Source)
      .update({ id: 'squad' }, { type: SourceType.Squad });
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { comments: 6 });
    await repo.update({ id: 'p3' }, { comments: 5 });
    await repo.update({ id: 'p2' }, { comments: 5, sourceId: 'squad' });

    const res = await client.query(QUERY(30));
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should not return posts from public squads', async () => {
    await con
      .getRepository(Source)
      .update({ id: 'squad' }, { type: SourceType.Squad, private: false });
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { comments: 6 });
    await repo.update({ id: 'p3' }, { comments: 5 });
    await repo.update({ id: 'p2' }, { comments: 5, sourceId: 'squad' });

    const res = await client.query(QUERY(30));
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return posts from provided source', async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { comments: 6 });
    await repo.update({ id: 'p3' }, { comments: 6 });
    await repo.update({ id: 'p4' }, { comments: 6 });

    const res = await client.query(QUERY(30, 'a'));
    expect(res.errors).toBeFalsy();
    expect(res.data.mostDiscussedFeed.edges.length).toEqual(2);
    res.data.mostDiscussedFeed.edges.forEach(({ node }) => {
      expect(node.source.id).toEqual('a');
    });
  });

  it('should return posts from provided tag', async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { comments: 6 });
    await repo.update({ id: 'p3' }, { comments: 6 });
    await repo.update({ id: 'p4' }, { comments: 6 });

    const res = await client.query(QUERY(30, '', 'javascript'));
    expect(res.errors).toBeFalsy();
    expect(res.data.mostDiscussedFeed.edges.length).toEqual(2);
    res.data.mostDiscussedFeed.edges.forEach(({ node }) => {
      expect(node.tags).toContain('javascript');
    });
  });
});

describe('query randomTrendingPosts', () => {
  const QUERY = `query RandomTrendingPosts($first: Int, $post: ID) {
    randomTrendingPosts(first: $first, post: $post) {
      id
    }
  }`;

  beforeEach(async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { trending: 20 });
    await repo.update({ id: 'p3' }, { trending: 50 });
  });

  it('should return random trending posts', async () => {
    const res = await client.query(QUERY, { variables: { first: 10 } });
    expect(res.errors).toBeFalsy();
    expect(res.data.randomTrendingPosts.map((post) => post.id).sort()).toEqual([
      'p1',
      'p3',
    ]);
  });

  it('should filter out the given post', async () => {
    const res = await client.query(QUERY, {
      variables: { first: 10, post: 'p1' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.randomTrendingPosts.map((post) => post.id).sort()).toEqual([
      'p3',
    ]);
  });
});

describe('query similarPostsFeed', () => {
  const QUERY = `query SimilarPostsFeed($postId: ID!, $first: Int) {
    similarPostsFeed(post_id: $postId, first: $first) {
      ${feedFields()}
    }
  }`;

  it('should return posts from feed service', async () => {
    nock('http://localhost:6000')
      .post('/feed.json', {
        feed_config_name: 'post_similarity',
        total_pages: 1,
        page_size: 30,
        post_id: 'p1',
        offset: 0,
        fresh_page_size: '10',
      })
      .reply(200, {
        data: [{ post_id: 'p3' }, { post_id: 'p5' }],
      });

    const res = await client.query(QUERY, {
      variables: { postId: 'p1' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.similarPostsFeed.edges.length).toEqual(2);
    expect(
      res.data.similarPostsFeed.edges.forEach(({ node }) =>
        expect(['p3', 'p5']).toContain(node.id),
      ),
    );
  });
});

describe('query randomSimilarPostsByTags', () => {
  const QUERY = `query RandomSimilarPostsByTags($post: ID, $tags: [String]!, $first: Int) {
    randomSimilarPostsByTags(post: $post, first: $first, tags: $tags) {
      id
    }
  }`;

  // it('should return posts from feed service', async () => {
  //   nock('http://localhost:6000')
  //     .post('/feed.json', {
  //       feed_config_name: 'post_similarity',
  //       total_pages: 1,
  //       page_size: 3,
  //       post_id: 'p1',
  //       fresh_page_size: '1',
  //     })
  //     .reply(200, {
  //       data: [{ post_id: 'p3' }, { post_id: 'p5' }],
  //     });
  //
  //   const res = await client.query(QUERY, {
  //     variables: { post: 'p1', tags: ['webdev', 'javascript'] },
  //   });
  //   expect(res.errors).toBeFalsy();
  //   expect(
  //     res.data.randomSimilarPostsByTags.map((post) => post.id).sort(),
  //   ).toEqual(['p3', 'p5']);
  // });

  it('should fallback to old algorithm', async () => {
    nock('http://localhost:6000')
      .post('/feed.json', {
        feed_config_name: 'post_similarity',
        total_pages: 1,
        page_size: 3,
        post_id: 'p1',
        fresh_page_size: '1',
      })
      .reply(200, {
        data: [],
      });

    const repo = con.getRepository(Post);
    const now = new Date();
    await con.getRepository(Keyword).save([
      { value: 'javascript', status: 'allow' },
      { value: 'webdev', status: 'deny' },
      { value: 'backend', status: 'allow' },
    ]);
    await con.getRepository(PostKeyword).save([
      { keyword: 'backend', postId: 'p2' },
      { keyword: 'javascript', postId: 'p3' },
    ]);
    await repo.update(
      { id: 'p4' },
      {
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30 * 8),
      },
    );

    const res = await client.query(QUERY, {
      variables: { post: 'p1', tags: ['webdev', 'javascript'] },
    });
    expect(res.errors).toBeFalsy();
    // Temporary turned off
    expect(
      res.data.randomSimilarPostsByTags.map((post) => post.id).sort(),
    ).toEqual([]);
    // expect(
    //   res.data.randomSimilarPostsByTags.map((post) => post.id).sort(),
    // ).toEqual(['p3', 'p5']);
  });

  it('should fallback to old algorithm even when tags not provided', async () => {
    nock('http://localhost:6000')
      .post('/feed.json', {
        feed_config_name: 'post_similarity',
        total_pages: 1,
        page_size: 3,
        post_id: 'p1',
        fresh_page_size: '1',
      })
      .reply(200, {
        data: [],
      });

    const repo = con.getRepository(Post);
    const now = new Date();
    await con.getRepository(Keyword).save([
      { value: 'javascript', status: 'allow' },
      { value: 'webdev', status: 'deny' },
      { value: 'backend', status: 'allow' },
    ]);
    await con.getRepository(PostKeyword).save([
      { keyword: 'backend', postId: 'p2' },
      { keyword: 'javascript', postId: 'p3' },
    ]);
    await repo.update(
      { id: 'p4' },
      {
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30 * 8),
      },
    );

    const res = await client.query(QUERY, {
      variables: { post: 'p1', tags: [] },
    });
    expect(res.errors).toBeFalsy();
    // Temporary turned off
    expect(res.data.randomSimilarPostsByTags.length).toEqual(0);
    // expect(res.data.randomSimilarPostsByTags.length).toEqual(3);
  });
});

describe('query randomDiscussedPosts', () => {
  const QUERY = `query RandomDiscussedPosts($first: Int, $post: ID) {
    randomDiscussedPosts(first: $first, post: $post) {
      id
    }
  }`;

  beforeEach(async () => {
    const repo = con.getRepository(Post);
    await repo.update({ id: 'p1' }, { createdAt: new Date(), comments: 10 });
    await repo.update({ id: 'p3' }, { createdAt: new Date(), comments: 15 });
  });

  it('should return random discussed posts', async () => {
    const res = await client.query(QUERY, { variables: { first: 10 } });
    expect(res.errors).toBeFalsy();
    expect(res.data.randomDiscussedPosts.map((post) => post.id).sort()).toEqual(
      ['p1', 'p3'],
    );
  });

  it('should filter out the given post', async () => {
    const res = await client.query(QUERY, {
      variables: { first: 10, post: 'p1' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.randomDiscussedPosts.map((post) => post.id).sort()).toEqual(
      ['p3'],
    );
  });
});

describe('query tagsCategories', () => {
  it('should return a list of categories with a property of a string array as tags', async () => {
    const QUERY = `{
      tagsCategories {
        id
        title
        tags
        emoji
      }
    }`;

    await saveFeedFixtures();

    const res = await client.query(QUERY);

    expect(res.data).toMatchSnapshot();
  });
});

describe('query advancedSettings', () => {
  it('should return the list of the advanced settings', async () => {
    const QUERY = `{
      advancedSettings {
        id
        title
        description
        defaultEnabledState
      }
    }`;

    const res = await client.query(QUERY);
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation updateFeedAdvancedSettings', () => {
  const MUTATION = `
    mutation UpdateFeedAdvancedSettings($settings: [FeedAdvancedSettingsInput]!) {
      updateFeedAdvancedSettings(settings: $settings) {
        id
        enabled
      }
    }
  `;

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          settings: [
            { id: 1, enabled: true },
            { id: 2, enabled: false },
          ],
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should add the new feed advanced settings', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, AdvancedSettings, advancedSettings);
    const res = await client.mutate(MUTATION, {
      variables: {
        settings: [
          { id: 1, enabled: true },
          { id: 2, enabled: false },
        ],
      },
    });

    expect(res.data).toMatchSnapshot();
  });

  it('should not fail if feed entity does not exists', async () => {
    loggedUser = '1';
    await saveFixtures(con, AdvancedSettings, advancedSettings);
    const res = await client.mutate(MUTATION, {
      variables: {
        settings: [
          { id: 1, enabled: true },
          { id: 2, enabled: false },
        ],
      },
    });

    expect(res.data).toMatchSnapshot();
  });

  it('should update existing feed advanced settings', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.mutate(MUTATION, {
      variables: {
        settings: [
          { id: 1, enabled: false },
          { id: 2, enabled: true },
          { id: 3, enabled: true },
          { id: 4, enabled: false },
          { id: 7, enabled: false },
        ],
      },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should ignore duplicates', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.mutate(MUTATION, {
      variables: {
        settings: [
          { id: 1, enabled: true },
          { id: 2, enabled: false },
          { id: 3, enabled: false },
          { id: 4, enabled: true },
          { id: 7, enabled: true },
        ],
      },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation addFiltersToFeed', () => {
  const MUTATION = `
  mutation AddFiltersToFeed($feedId: ID, $filters: FiltersInput!) {
    addFiltersToFeed(feedId: $feedId, filters: $filters) {
      id
      userId
      includeTags
      blockedTags
      excludeSources {
        id
        name
        image
        public
      }
      advancedSettings {
        id
        enabled
      }
    }
  }`;
  const MY_FEED_SETTINGS_QUERY = `{
    feedSettings {
      id
      userId
      includeTags
      blockedTags
      excludeSources {
        id
        name
        image
        public
      }
      advancedSettings {
        id
        enabled
        advancedSettings {
          id
          title
          description
          group
        }
      }
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { filters: { excludeSources: ['a'] } },
      },
      'UNAUTHENTICATED',
    ));

  it('should add the new feed settings', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '2', userId: '1' }]);
    await saveFixtures(con, AdvancedSettings, advancedSettings);
    const res = await client.mutate(MUTATION, {
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b'],
          blockedTags: ['golang'],
        },
      },
    });

    const contentPreferenceTags = await con
      .getRepository(ContentPreferenceKeyword)
      .find({
        where: {
          userId: '1',
          feedId: '1',
        },
        order: {
          keywordId: 'ASC',
        },
      });

    expect(contentPreferenceTags).toEqual([
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'golang',
        referenceId: 'golang',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'javascript',
        referenceId: 'javascript',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'webdev',
        referenceId: 'webdev',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const contentPreferenceSources = await con
      .getRepository(ContentPreferenceSource)
      .find({
        where: {
          userId: '1',
          feedId: '1',
        },
        order: {
          sourceId: 'ASC',
        },
      });

    expect(contentPreferenceSources).toEqual([
      {
        createdAt: expect.any(Date),
        feedId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: expect.any(String),
        },
        referenceId: 'a',
        sourceId: 'a',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Source,
        userId: '1',
      },
      {
        createdAt: expect.any(Date),
        feedId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: expect.any(String),
        },
        referenceId: 'b',
        sourceId: 'b',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Source,
        userId: '1',
      },
    ]);

    expect(res.data).toMatchSnapshot();
  });

  it('should ignore duplicates', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.mutate(MUTATION, {
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b'],
          blockedTags: ['golang'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should ignore non existing sources', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b', 'deleted'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should save filters to custom feed when feedId is provided', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: 'cf2', userId: '1' }]);
    await saveFixtures(con, AdvancedSettings, advancedSettings);
    // my feed filters
    await client.mutate(MUTATION, {
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a'],
          blockedTags: [],
        },
      },
    });

    const res = await client.mutate(MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['webdev'],
          excludeSources: ['b'],
          blockedTags: ['golang'],
        },
      },
    });
    expect(res.data.addFiltersToFeed).toMatchObject({
      includeTags: ['webdev'],
      excludeSources: [
        {
          id: 'b',
          image: 'http://image.com/b',
          name: 'B',
          public: true,
        },
      ],
      blockedTags: ['golang'],
    });

    const myFeedSettings = await client.query(MY_FEED_SETTINGS_QUERY);
    expect(myFeedSettings.data.feedSettings).toMatchObject({
      includeTags: ['javascript', 'webdev'],
      excludeSources: [
        {
          id: 'a',
          image: 'http://image.com/a',
          name: 'A',
          public: true,
        },
      ],
      blockedTags: [],
    });
  });

  it('should throw not found error when feedId is not found', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf256',
          filters: {
            includeTags: ['webdev'],
            excludeSources: ['b'],
            blockedTags: ['golang'],
          },
        },
      },
      'NOT_FOUND',
    );
  });

  it('should save filters to multiple custom feeds when feedId is provided', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [
      { id: 'cf2', userId: '1' },
      {
        id: 'cf3',
        userId: '1',
      },
      {
        id: 'cf4',
        userId: '1',
      },
    ]);
    await saveFixtures(con, AdvancedSettings, advancedSettings);
    // my feed filters
    await client.mutate(MUTATION, {
      variables: {
        filters: {
          includeTags: ['webdev'],
          excludeSources: [],
          blockedTags: [],
        },
      },
    });

    await client.mutate(MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['webdev'],
        },
      },
    });

    await client.mutate(MUTATION, {
      variables: {
        feedId: 'cf3',
        filters: {
          includeTags: ['webdev'],
        },
      },
    });

    const contentPreferences = await con
      .getRepository(ContentPreferenceKeyword)
      .find({
        where: {
          userId: '1',
        },
        order: {
          createdAt: 'ASC',
        },
      });

    expect(contentPreferences.length).toEqual(3);
    expect(contentPreferences).toEqual([
      {
        userId: '1',
        feedId: '1',
        keywordId: 'webdev',
        referenceId: 'webdev',
        type: ContentPreferenceType.Keyword,
        status: ContentPreferenceStatus.Follow,
        createdAt: expect.any(Date),
      },
      {
        userId: '1',
        feedId: 'cf2',
        keywordId: 'webdev',
        referenceId: 'webdev',
        type: ContentPreferenceType.Keyword,
        status: ContentPreferenceStatus.Follow,
        createdAt: expect.any(Date),
      },
      {
        userId: '1',
        feedId: 'cf3',
        keywordId: 'webdev',
        referenceId: 'webdev',
        type: ContentPreferenceType.Keyword,
        status: ContentPreferenceStatus.Follow,
        createdAt: expect.any(Date),
      },
    ]);
  });
});

describe('mutation removeFiltersFromFeed', () => {
  const MUTATION = `
  mutation RemoveFiltersFromFeed($feedId: ID, $filters: FiltersInput!) {
    removeFiltersFromFeed(feedId: $feedId, filters: $filters) {
      id
      userId
      includeTags
      blockedTags
      includeSources {
        id
        name
        image
        public
      }
      excludeSources {
        id
        name
        image
        public
      }
      advancedSettings {
        id
        enabled
      }
    }
  }`;
  const ADD_FILTERS_MUTATION = `
  mutation AddFiltersToFeed($feedId: ID, $filters: FiltersInput!) {
    addFiltersToFeed(feedId: $feedId, filters: $filters) {
      id
      userId
      includeTags
      blockedTags
      includeSources {
        id
        name
        image
        public
      }
      excludeSources {
        id
        name
        image
        public
      }
      advancedSettings {
        id
        enabled
      }
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { filters: { excludeSources: ['a'] } },
      },
      'UNAUTHENTICATED',
    ));

  it('should remove existing filters', async () => {
    loggedUser = '1';
    await saveFeedFixtures();

    const contentPreferenceTags = await con
      .getRepository(ContentPreferenceKeyword)
      .find({
        where: {
          userId: '1',
          feedId: '1',
        },
        order: {
          keywordId: 'ASC',
        },
      });

    expect(contentPreferenceTags).toEqual([
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'golang',
        referenceId: 'golang',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'html',
        referenceId: 'html',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'javascript',
        referenceId: 'javascript',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const contentPreferenceSources = await con
      .getRepository(ContentPreferenceSource)
      .find({
        where: {
          userId: '1',
          feedId: '1',
        },
        order: {
          sourceId: 'ASC',
        },
      });

    expect(contentPreferenceSources).toEqual([
      {
        createdAt: expect.any(Date),
        feedId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: expect.any(String),
        },
        referenceId: 'b',
        sourceId: 'b',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Source,
        userId: '1',
      },
      {
        createdAt: expect.any(Date),
        feedId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: expect.any(String),
        },
        referenceId: 'c',
        sourceId: 'c',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Source,
        userId: '1',
      },
    ]);

    const res = await client.mutate(MUTATION, {
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b'],
          blockedTags: ['golang'],
        },
      },
    });

    const contentPreferenceTagsAfter = await con
      .getRepository(ContentPreferenceKeyword)
      .find({
        where: {
          userId: '1',
          feedId: '1',
        },
        order: {
          keywordId: 'ASC',
        },
      });

    expect(contentPreferenceTagsAfter).toEqual([
      {
        createdAt: expect.any(Date),
        feedId: '1',
        keywordId: 'html',
        referenceId: 'html',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const contentPreferenceSourcesAfter = await con
      .getRepository(ContentPreferenceSource)
      .find({
        where: {
          userId: '1',
          feedId: '1',
        },
        order: {
          sourceId: 'ASC',
        },
      });

    expect(contentPreferenceSourcesAfter).toEqual([
      {
        createdAt: expect.any(Date),
        feedId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: expect.any(String),
        },
        referenceId: 'c',
        sourceId: 'c',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Source,
        userId: '1',
      },
    ]);

    expect(res.data).toMatchSnapshot();
  });

  it('should remove existing filters for custom feed when feedId is provided', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await saveFixtures(con, Feed, [{ id: 'cf2', userId: '1' }]);
    await client.mutate(ADD_FILTERS_MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['webdev', 'javascript'],
          includeSources: ['includedSource'],
          excludeSources: ['a', 'b'],
          blockedTags: ['golang'],
        },
      },
    });

    const res = await client.mutate(MUTATION, {
      variables: {
        feedId: 'cf2',
        filters: {
          includeTags: ['webdev'],
          includeSources: ['includedSource', 'b'],
          excludeSources: ['a'],
          blockedTags: ['golang'],
        },
      },
    });
    expect(res.data.removeFiltersFromFeed).toMatchObject({
      includeTags: ['javascript'],
      includeSources: [],
      excludeSources: [
        {
          id: 'b',
          image: 'http://image.com/b',
          name: 'B',
          public: true,
        },
      ],
      blockedTags: [],
    });
  });

  it('should throw not found error when feedId is not found', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf256',
          filters: {
            includeTags: ['webdev'],
            excludeSources: ['b'],
            blockedTags: ['golang'],
          },
        },
      },
      'NOT_FOUND',
    );
  });
});

describe('function feedToFilters', () => {
  it('should return filters having excluded sources based on advanced settings', async () => {
    loggedUser = '1';
    await saveAdvancedSettingsFiltersFixtures();
    await con.getRepository(ContentPreferenceSource).save([
      {
        feedId: '1',
        sourceId: 'excludedSource',
        userId: '1',
        status: ContentPreferenceStatus.Blocked,
        referenceId: 'excludedSource',
      },
      {
        feedId: '1',
        sourceId: 'settingsCombinationSource',
        userId: '1',
        status: ContentPreferenceStatus.Blocked,
        referenceId: 'settingsCombinationSource',
      },
    ]);
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.excludeSources).toEqual([
      'excludedSource',
      'settingsCombinationSource',
    ]);
  });

  it('should return filters having excluded content types based on advanced settings', async () => {
    loggedUser = '1';
    await saveAdvancedSettingsFiltersFixtures();
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.excludeTypes).toEqual(['video:youtube']);
  });

  it('should return filters for tags/sources based on the values from our data', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.blockedContentCuration).toEqual([]);
    expect(filters.excludeTypes).toEqual([]);
    expect(filters.sourceIds).toEqual([]);
    expect(filters.includeTags).toEqual(
      expect.arrayContaining(['html', 'javascript']),
    );
    expect(filters.includeTags?.length).toBe(2);
    expect(filters.blockedTags).toEqual(expect.arrayContaining(['golang']));
    expect(filters.blockedTags?.length).toBe(1);
    expect(filters.excludeSources).toEqual(expect.arrayContaining(['b', 'c']));
    expect(filters.excludeSources?.length).toBe(2);
  });

  it('should return filters with source memberships', async () => {
    loggedUser = '1';
    await saveFixtures(con, User, [usersFixture[0]]);
    await saveFixtures(
      con,
      Source,
      sourcesFixture.map((item) => ({
        ...item,
        id: `${item.id}-sqvf`,
        handle: `${item.handle}-sqvf`,
        type: SourceType.Squad,
      })),
    );
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a-sqvf',
        referenceId: 'a-sqvf',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 'b-sqvf',
        referenceId: 'b-sqvf',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'rt2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    expect(await feedToFilters(con, '1', '1')).toMatchSnapshot();
  });

  it('should return filters with blocked content types', async () => {
    loggedUser = '1';
    await saveFixtures(con, User, [usersFixture[0]]);
    await con.getRepository(AdvancedSettings).save({
      id: 1,
      title: 'test',
      group: 'content_curation',
      options: { type: 'listicle' },
      description: '',
      defaultEnabledState: true,
    });
    await con.getRepository(Feed).save({ id: '1', userId: '1' });
    await con.getRepository(FeedAdvancedSettings).save({
      feedId: '1',
      advancedSettingsId: 1,
      enabled: false,
    });
    expect(await feedToFilters(con, '1', '1')).toMatchSnapshot();
  });

  it('should return filters with blocked source types', async () => {
    loggedUser = '1';
    await saveFixtures(con, User, [usersFixture[0]]);
    await con.getRepository(AdvancedSettings).save({
      id: 1,
      title: 'test',
      group: 'source_types',
      options: { type: 'squad' },
      description: '',
      defaultEnabledState: true,
    });
    await con.getRepository(Feed).save({ id: '1', userId: '1' });
    await con.getRepository(FeedAdvancedSettings).save({
      feedId: '1',
      advancedSettingsId: 1,
      enabled: false,
    });
    expect(await feedToFilters(con, '1', '1')).toMatchSnapshot();
  });

  it('should return filters with blocked words', async () => {
    loggedUser = '1';
    await saveFixtures(con, User, [usersFixture[0]]);
    await con.getRepository(Feed).save({ id: '1', userId: '1' });
    await con.getRepository(ContentPreferenceWord).save([
      {
        userId: '1',
        feedId: '1',
        referenceId: 'word-abc',
        status: ContentPreferenceStatus.Blocked,
      },
      {
        userId: '1',
        feedId: '1',
        referenceId: 'word-def',
        status: ContentPreferenceStatus.Blocked,
      },
    ]);
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.blockedWords).toEqual(['word-abc', 'word-def']);
  });

  it('should not return source in sourceIds if member set hideFeedPosts to true', async () => {
    loggedUser = '1';
    await con.getRepository(User).save(usersFixture[0]);
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: true });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '1',
        createdAt: new Date(2022, 11, 19),
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
          hideFeedPosts: true,
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.sourceIds).not.toContain('a');
    expect(filters.excludeSources).toContain('a');
  });

  it('should return source in sourceIds if member set hideFeedPosts to false', async () => {
    loggedUser = '1';
    await con.getRepository(User).save(usersFixture[0]);
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: true });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '1',
        createdAt: new Date(2022, 11, 19),
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
          hideFeedPosts: false,
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.sourceIds).toContain('a');
  });

  it('should return source in sourceIds if hideFeedPosts is not set', async () => {
    loggedUser = '1';
    await con.getRepository(User).save(usersFixture[0]);
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: true });
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'a',
        referenceId: 'a',
        userId: '1',
        createdAt: new Date(2022, 11, 19),
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    const filters = await feedToFilters(con, '1', '1');
    expect(filters.sourceIds).toContain('a');
  });
});

describe('query feedPreview', () => {
  const QUERY = `
  query FeedPreview($supportedTypes: [String!], $filters: FiltersInput) {
    feedPreview(supportedTypes: $supportedTypes, filters: $filters) {
      ${feedFields()}
    }
  }
`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: {} },
      'UNAUTHENTICATED',
    ));

  it('should return feed', async () => {
    loggedUser = '1';

    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, ContentPreferenceKeyword, [
      {
        feedId: '1',
        keywordId: 'html',
        referenceId: 'html',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);
    nock('http://localhost:6000')
      .post('/feed.json', {
        feed_config_name: 'onboarding',
        total_pages: 1,
        page_size: 20,
        offset: 0,
        fresh_page_size: '7',
        user_id: '1',
        allowed_tags: ['html'],
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
      });

    const res = await client.query(QUERY, { variables: {} });

    expect(res.errors).toBeFalsy();
    expect(res.data.feedPreview.edges.length).toEqual(2);
  });

  it('should return feed with filters', async () => {
    loggedUser = '1';

    nock('http://localhost:6000')
      .post('/popular', {
        user_id: '1',
        page_size: 20,
        offset: 0,
        total_pages: 1,
        fresh_page_size: '7',
        allowed_tags: ['javascript', 'webdev'],
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
      });

    const res = await client.query(QUERY, {
      variables: {
        filters: {
          includeTags: ['javascript', 'webdev'],
        },
      },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.feedPreview.edges.length).toEqual(2);
  });
});

describe('query userUpvotedFeed', () => {
  const QUERY = `
  query UserUpvotedFeed($userId: ID!, $first: Int, $after: String) {
    userUpvotedFeed(userId: $userId, first: $first, after: $after) {
      ${feedFields()}
    }
  }
`;

  beforeEach(async () => {
    await con.getRepository(UserPost).insert([
      {
        userId: '2',
        postId: 'p1',
        vote: UserVote.Up,
        votedAt: new Date(2023, 13, 26),
      },
      {
        userId: '2',
        postId: 'p3',
        vote: UserVote.Up,
        votedAt: new Date(2023, 13, 24),
      },
      {
        userId: '2',
        postId: 'p2',
        vote: UserVote.Down,
        votedAt: new Date(2023, 13, 23),
      },
      {
        userId: '1',
        postId: 'p4',
        vote: UserVote.Up,
        votedAt: new Date(2023, 13, 23),
      },
    ]);
  });

  it('should return upvotes ordered by time', async () => {
    const res = await client.query(QUERY, { variables: { userId: '2' } });
    res.data.userUpvotedFeed.edges.forEach(({ node }) =>
      expect(['p1', 'p3']).toContain(node.id),
    );
  });

  it('should include banned posts', async () => {
    await con.getRepository(Post).update({ id: 'p3' }, { banned: true });
    const res = await client.query(QUERY, { variables: { userId: '2' } });
    res.data.userUpvotedFeed.edges.forEach(({ node }) =>
      expect(['p1', 'p3']).toContain(node.id),
    );
  });
});

describe('flags field', () => {
  const QUERY = `{
    feedList {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          flags {
            name
          }
        }
      }
    }
  }`;

  beforeEach(async () => {
    loggedUser = '1';
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        userId: '1',
        flags: {},
      },
    ]);
  });

  it('should return all the public flags', async () => {
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        flags: {
          name: 'Cool feed',
        },
      },
    ]);

    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.feedList.edges.length).toEqual(1);
    expect(res.data.feedList.edges[0].node.flags).toEqual({
      name: 'Cool feed',
    });
  });

  it('should return null values for unset flags', async () => {
    const res = await client.query(QUERY);
    expect(res.data.feedList.edges[0].node.flags).toEqual({
      name: null,
    });
  });

  it('should contain all default values in db query', async () => {
    const feed = await con.getRepository(Feed).findOneBy({ id: 'cf1' });
    expect(feed?.flags).toEqual({});
  });
});

describe('slug field', () => {
  const QUERY = `{
    feedList {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          slug
        }
      }
    }
  }`;

  beforeEach(async () => {
    loggedUser = '1';
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
    ]);
  });

  it('should return the slug', async () => {
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.feedList.edges[0].node.slug).toEqual('cool-feed-cf1');
  });

  it('should return slug when name is unset', async () => {
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        flags: {},
      },
    ]);

    const res = await client.query(QUERY);
    expect(res.data.feedList.edges[0].node.slug).toEqual('cf1');
  });
});

describe('query feedList', () => {
  const QUERY = `{
    feedList {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          userId
          flags {
            name
          }
          slug
        }
      }
    }
  }`;

  beforeEach(async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
      {
        id: 'cf2',
        userId: '1',
        flags: {
          name: 'PHP feed',
        },
      },
      {
        id: 'cf3',
        userId: '1',
        flags: {
          name: 'Awful feed',
        },
      },
    ]);
  });

  it('should not authorize when not logged-in', () => {
    loggedUser = '';

    return testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED');
  });

  it('should return the feed list', async () => {
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      feedList: {
        pageInfo: {
          endCursor: expect.any(String),
          hasNextPage: false,
        },
        edges: [
          {
            node: {
              id: 'cf1',
              userId: '1',
              flags: {
                name: 'Cool feed',
              },
              slug: 'cool-feed-cf1',
            },
          },
          {
            node: {
              id: 'cf2',
              userId: '1',
              flags: {
                name: 'PHP feed',
              },
              slug: 'php-feed-cf2',
            },
          },
          {
            node: {
              id: 'cf3',
              userId: '1',
              flags: {
                name: 'Awful feed',
              },
              slug: 'awful-feed-cf3',
            },
          },
        ],
      },
    });
  });

  it('should not return the user default feed', async () => {
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.feedList.edges.map((edge) => edge.node.id)).not.toContain(
      '1',
    );
  });
});

describe('query getFeed', () => {
  const QUERY = `
  query GetFeed($feedId: ID!) {
    getFeed(feedId: $feedId) {
      id
      userId
      flags {
        name
      }
    }
  }
`;

  beforeEach(async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
    ]);
  });

  it('should not authorize when not logged-in', () => {
    loggedUser = '';

    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { feedId: 'cf1' } },
      'UNAUTHENTICATED',
    );
  });

  it('should return the feed', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { feedId: 'cf1' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      getFeed: {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
    });
  });

  it('should return the feed by slug', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { feedId: 'cool-feed-cf1' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      getFeed: {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
    });
  });

  it('should not return the feed when the user does not own it', () => {
    loggedUser = '2';

    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { feedId: 'cf1' },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when feed does not exist', () => {
    loggedUser = '2';

    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { feedId: 'cf256' },
      },
      'NOT_FOUND',
    );
  });
});

describe('mutation createFeed', () => {
  const MUTATION = `
  mutation CreateFeed($name: String!) {
    createFeed(name: $name) {
      id
      userId
      flags {
        name
      }
    }
  }
`;

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          name: 'Cool feed',
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should create a new feed', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        name: 'Cool feed',
      },
    });

    expect(res.data).toMatchObject({
      createFeed: {
        id: expect.any(String),
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
    });
    expect(
      await con.getRepository(Feed).findOneBy({ id: res.data.createFeed.id }),
    ).toMatchObject({
      id: expect.any(String),
      userId: '1',
      flags: { name: 'Cool feed' },
    });
  });

  it('should not create a new feed when name is missing', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {},
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not create a new feed when name is empty', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          name: '',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not create a new feed if the user has reached the limit', async () => {
    loggedUser = '1';

    await saveFixtures(
      con,
      Feed,
      new Array(maxFeedsPerUser + 1).fill(null).map((item, index) => {
        return {
          id: `cf${index}`,
          userId: '1',
          flags: { name: `Cool feed ${index}` },
        };
      }),
    );

    await testMutationError(
      client,
      {
        mutation: MUTATION,
        variables: {
          name: 'Cool feed',
        },
      },
      (errors) => {
        expect(errors.length).toEqual(1);
        expect(errors[0].extensions?.code).toEqual('GRAPHQL_VALIDATION_FAILED');
        expect(errors[0]?.message).toEqual(
          SubmissionFailErrorMessage.FEED_COUNT_LIMIT_REACHED,
        );
      },
    );
  });

  it('should not create a new feed when name contains special characters', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          name: 'Cool feed <div>aaa</div>',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not create a new feed when name is too long', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
          name: new Array(maxFeedNameLength + 1).fill('a').join(''),
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });
});

describe('mutation updateFeed', () => {
  const MUTATION = `
  mutation UpdateFeed($feedId: ID!, $name: String!) {
    updateFeed(feedId: $feedId, name: $name) {
      id
      userId
      flags {
        name
      }
    }
  }
`;

  beforeEach(async () => {
    await saveFixtures(con, Feed, [
      { id: 'cf1', userId: '1', flags: { name: 'Cool feed' } },
    ]);
  });

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
          name: 'Cool feed',
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should not update when different user owns the feed', () => {
    loggedUser = '2';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
          name: 'Cool feed',
        },
      },
      'NOT_FOUND',
    );
  });

  it('should update the feed', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables: {
        feedId: 'cf1',
        name: 'PHP feed',
      },
    });

    expect(res.data).toMatchObject({
      updateFeed: {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'PHP feed',
        },
      },
    });
    expect(
      await con.getRepository(Feed).findOneBy({ id: 'cf1' }),
    ).toMatchObject({
      id: 'cf1',
      userId: '1',
      flags: { name: 'PHP feed' },
    });
  });

  it('should not update the feed when feedId is missing', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          name: 'Cool feed',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update the feed when name is missing', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update the feed when name is empty', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
          name: '',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update the feed when name contains special characters', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
          name: 'Cool feed <div>aaa</div>',
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update the feed when name is too long', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
          name: new Array(maxFeedNameLength + 1).fill('a').join(''),
        },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });
});

describe('mutation deleteFeed', () => {
  const MUTATION = `
  mutation DeleteFeed($feedId: ID!) {
    deleteFeed(feedId: $feedId) {
      _
    }
  }
`;

  beforeEach(async () => {
    await saveFixtures(con, Feed, [
      { id: 'cf1', userId: '1', flags: { name: 'Cool feed' } },
    ]);
  });

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: 'cf1',
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should delete the feed', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables: {
        feedId: 'cf1',
      },
    });

    expect(res.errors).toBeFalsy();
    expect(await con.getRepository(Feed).count()).toBe(0);
  });

  it('should not delete the feed when feedId is missing', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {},
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not delete the feed when feedId is empty', async () => {
    loggedUser = '1';

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: '',
        },
      },
      'NOT_FOUND',
    );

    expect(await con.getRepository(Feed).count()).toBe(1);
  });

  it('should not delete my feed', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);

    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          feedId: '1',
        },
      },
      'FORBIDDEN',
    );

    expect(await con.getRepository(Feed).count()).toBe(2);
  });
});

describe('query customFeed', () => {
  const QUERY = `
  query CustomFeed($feedId: ID!, $ranking: Ranking, $first: Int, $after: String, $supportedTypes: [String!], $version: Int) {
    customFeed(feedId: $feedId, ranking: $ranking, first: $first, after: $after, supportedTypes: $supportedTypes, version: $version) {
      ${feedFields()}
    }
  }
`;

  beforeEach(async () => {
    loggedUser = '1';

    await saveFeedFixtures();
    await con.getRepository(Feed).save([
      {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
      },
    ]);
    await con.getRepository(ContentPreferenceKeyword).save([
      {
        feedId: 'cf1',
        keywordId: 'webdev',
        referenceId: 'webdev',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        feedId: 'cf1',
        keywordId: 'html',
        referenceId: 'html',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
      {
        feedId: 'cf1',
        keywordId: 'data',
        referenceId: 'data',
        status: ContentPreferenceStatus.Follow,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);
  });

  it('should not authorize feed when not logged-in', () => {
    loggedUser = '';

    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: {
          ranking: Ranking.POPULARITY,
          first: 10,
          feedId: 'cf1',
        },
      },
      'UNAUTHENTICATED',
    );
  });

  it('should return the feed by slug', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: {
        ranking: Ranking.POPULARITY,
        first: 10,
        feedId: 'cool-feed-cf1',
      },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.customFeed).toBeTruthy();
  });

  it('should not return the feed when the user does not own it', () => {
    loggedUser = '2';

    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { ranking: Ranking.POPULARITY, first: 10, feedId: 'cf1' },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when feed does not exist', () => {
    loggedUser = '2';

    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { ranking: Ranking.POPULARITY, first: 10, feedId: 'cf1' },
      },
      'NOT_FOUND',
    );
  });

  it('should return feed with preconfigured filters', async () => {
    loggedUser = '1';

    const res = await client.query(QUERY, {
      variables: {
        ranking: Ranking.POPULARITY,
        first: 10,
        feedId: 'cf1',
      },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.customFeed.edges.map((item) => item.node.id)).toMatchObject(
      ['p5', 'p4', 'p1'],
    );
  });

  it('should not return posts with blocked tags', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceKeyword).save([
      {
        feedId: 'cf1',
        keywordId: 'webdev',
        referenceId: 'webdev',
        status: ContentPreferenceStatus.Blocked,
        type: ContentPreferenceType.Keyword,
        userId: '1',
      },
    ]);

    const res = await client.query(QUERY, {
      variables: {
        ranking: Ranking.POPULARITY,
        first: 10,
        feedId: 'cf1',
      },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.customFeed.edges.map((item) => item.node.id)).toMatchObject(
      ['p5', 'p4'],
    );
  });

  it('should return v2 feed', async () => {
    loggedUser = '1';

    nock('http://localhost:6000')
      .post('/popular', {
        user_id: '1',
        page_size: 10,
        offset: 0,
        total_pages: 1,
        fresh_page_size: '4',
        allowed_tags: ['webdev', 'html', 'data'],
      })
      .reply(200, {
        data: [{ post_id: 'p1' }, { post_id: 'p4' }],
        cursor: 'b',
      });
    const res = await client.query(QUERY, {
      variables: {
        ranking: Ranking.POPULARITY,
        first: 10,
        feedId: 'cf1',
        version: 2,
      },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.customFeed.edges.map((item) => item.node.id)).toMatchObject(
      ['p1', 'p4'],
    );
  });
});
