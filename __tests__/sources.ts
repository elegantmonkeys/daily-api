import { randomUUID } from 'crypto';
import { DataSource, In, Not } from 'typeorm';
import { updateFlagsStatement, WELCOME_POST_TITLE } from '../src/common';
import { isNullOrUndefined } from '../src/common/object';
import createOrGetConnection from '../src/db';
import {
  defaultPublicSourceFlags,
  Feed,
  NotificationPreferenceSource,
  Post,
  PostKeyword,
  PostType,
  SharePost,
  Source,
  SourceFeed,
  SourceMember,
  SourceType,
  SquadPublicRequest,
  SquadPublicRequestStatus,
  SquadSource,
  User,
  WelcomePost,
} from '../src/entity';
import { DisallowHandle } from '../src/entity/DisallowHandle';
import { SourceCategory } from '../src/entity/sources/SourceCategory';
import { SourceTagView } from '../src/entity/SourceTagView';
import { SourcePermissionErrorKeys } from '../src/errors';
import { NotificationType } from '../src/notifications/common';
import { SourceMemberRoles, sourceRoleRank } from '../src/roles';
import { SourcePermissions } from '../src/schema/sources';
import { postKeywordsFixture, postsFixture } from './fixture/post';
import { createSource, sourcesFixture } from './fixture/source';
import { usersFixture } from './fixture/user';
import {
  disposeGraphQLTesting,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  saveFixtures,
  testMutationError,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../src/entity/contentPreference/types';
import { generateUUID } from '../src/ids';
import {
  SourcePostModeration,
  SourcePostModerationStatus,
} from '../src/entity/SourcePostModeration';

let con: DataSource;
let state: GraphQLTestingState;
let client: GraphQLTestClient;
let loggedUser: string = null;
let premiumUser: boolean;

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(
    () => new MockContext(con, loggedUser, premiumUser),
  );
  client = state.client;
});

const getSourceCategories = () => [
  {
    title: 'Basics',
    enabled: true,
  },
  {
    title: 'Web',
    enabled: true,
  },
  {
    title: 'Mobile',
    enabled: true,
  },
  {
    title: 'Games',
    enabled: true,
  },
  {
    title: 'DevOps & Cloud',
    enabled: true,
  },
  {
    title: 'Open Source',
    enabled: true,
  },
  {
    title: 'Career',
    enabled: true,
  },
  {
    title: 'AI',
    enabled: true,
  },
  {
    title: 'Fun',
    enabled: true,
  },
  {
    title: 'DevTools',
    enabled: true,
  },
  {
    title: 'DevRel',
    enabled: true,
  },
];

beforeEach(async () => {
  loggedUser = null;
  premiumUser = false;
  await saveFixtures(con, SourceCategory, getSourceCategories());
  await saveFixtures(con, Source, [
    sourcesFixture[0],
    sourcesFixture[1],
    sourcesFixture[5],
    sourcesFixture[6],
  ]);
  await saveFixtures(con, User, usersFixture);
  await saveFixtures(
    con,
    Feed,
    usersFixture.map((user) => ({ userId: user.id, id: user.id })),
  );
  await con
    .getRepository(Source)
    .update({ id: In(['a', 'b', 'c', 'squad']) }, { type: SourceType.Squad });

  const now = new Date(2022, 11, 19);

  await con.getRepository(SourceMember).save([
    {
      userId: '1',
      sourceId: 'a',
      role: SourceMemberRoles.Member,
      referralToken: 'rt',
      createdAt: new Date(now.getTime() + 0),
    },
    {
      userId: '2',
      sourceId: 'a',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
      createdAt: new Date(now.getTime() + 1000),
    },
    {
      userId: '2',
      sourceId: 'b',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
      createdAt: new Date(now.getTime() + 2000),
    },
    {
      userId: '3',
      sourceId: 'b',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
      createdAt: new Date(now.getTime() + 3000),
    },
    {
      userId: '1',
      sourceId: 'squad',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
      createdAt: new Date(now.getTime() + 4000),
    },
    {
      userId: '1',
      sourceId: 'm',
      role: SourceMemberRoles.Admin,
      referralToken: randomUUID(),
      createdAt: new Date(now.getTime() + 5000),
    },
  ]);

  await con.getRepository(SourceMember).update(
    {
      userId: '1',
    },
    { role: SourceMemberRoles.Admin },
  );
  await con
    .getRepository(SourceMember)
    .update({ userId: '2', sourceId: 'b' }, { role: SourceMemberRoles.Admin });

  await con.getRepository(ContentPreferenceSource).save([
    {
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      createdAt: new Date(now.getTime() + 0),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
    {
      sourceId: 'a',
      referenceId: 'a',
      userId: '2',
      createdAt: new Date(now.getTime() + 1000),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '2',
    },
    {
      sourceId: 'b',
      referenceId: 'b',
      userId: '2',
      createdAt: new Date(now.getTime() + 2000),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '3',
    },
    {
      sourceId: 'b',
      referenceId: 'b',
      userId: '3',
      createdAt: new Date(now.getTime() + 3000),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '3',
    },
    {
      sourceId: 'squad',
      referenceId: 'squad',
      userId: '1',
      createdAt: new Date(now.getTime() + 4000),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
    {
      sourceId: 'm',
      referenceId: 'm',
      userId: '1',
      createdAt: new Date(now.getTime() + 5000),
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
  ]);

  await con.getRepository(ContentPreferenceSource).update(
    {
      userId: '1',
    },
    {
      flags: updateFlagsStatement<ContentPreferenceSource>({
        role: SourceMemberRoles.Admin,
      }),
    },
  );
  await con.getRepository(ContentPreferenceSource).update(
    { userId: '2', referenceId: 'b' },
    {
      flags: updateFlagsStatement<ContentPreferenceSource>({
        role: SourceMemberRoles.Admin,
      }),
    },
  );
});

afterAll(() => disposeGraphQLTesting(state));

describe('query sourceCategory', () => {
  const QUERY = `
    query SourceCategory($id: String!) {
      sourceCategory(id: $id) {
        id
        slug
        title
      }
    }
  `;

  it('should return NOT_FOUND when category does not exist', async () => {
    loggedUser = '1';
    const uuid = randomUUID();

    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: uuid } },
      'NOT_FOUND',
    );
  });

  it('should return source category by id', async () => {
    loggedUser = '1';
    const [category] = await con.getRepository(SourceCategory).find();
    const res = await client.query(QUERY, { variables: { id: category.id } });

    expect(res.errors).toBeFalsy();
    expect(res.data.sourceCategory.id).toEqual(category.id);
    expect(res.data.sourceCategory.title).toEqual(category.title);
  });

  it('should return source category by slug', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { id: 'web' },
    });

    expect(res.errors).toBeFalsy();
    expect(res.data.sourceCategory.title).toEqual('Web');
    expect(res.data.sourceCategory.slug).toEqual('web');
  });

  it('should return source category by id as anonymous user', async () => {
    const [category] = await con.getRepository(SourceCategory).find();
    const res = await client.query(QUERY, { variables: { id: category.id } });

    expect(res.errors).toBeFalsy();
    expect(res.data.sourceCategory.id).toEqual(category.id);
    expect(res.data.sourceCategory.title).toEqual(category.title);
  });
});

describe('query sourceCategories', () => {
  const QUERY = `
    query SourceCategories($first: Int, $after: String) {
      sourceCategories(first: $first, after: $after) {
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            id
            slug
            title
          }
        }
      }
    }
  `;

  it('should return source categories', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    const categories = getSourceCategories();
    const isAllFound = res.data.sourceCategories.edges.every(({ node }) =>
      categories.some((category) => category.title === node.title),
    );
    expect(isAllFound).toBeTruthy();
  });

  it('should return source categories as an anonymous user', async () => {
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    const categories = getSourceCategories();
    const isAllFound = res.data.sourceCategories.edges.every(({ node }) =>
      categories.some((category) => category.title === node.title),
    );
    expect(isAllFound).toBeTruthy();
  });

  it('should return categories ordered by priority', async () => {
    await con.createQueryRunner().query(`
      DO $$
      DECLARE
          categories TEXT[] := ARRAY['Basics','Web','Mobile','DevOps & Cloud','AI','Games','DevTools','Career','Open Source','DevRel','Fun'];
          i INT;
      BEGIN
          -- Iterate over the array and update the table
          FOR i IN 1..array_length(categories, 1) LOOP
              UPDATE source_category
              SET priority = i
              WHERE slug = trim(BOTH '-' FROM regexp_replace(lower(trim(COALESCE(LEFT(categories[i],100),''))), '[^a-z0-9-]+', '-', 'gi'));
          END LOOP;
      END $$;
    `);
    const expected = [
      'Basics',
      'Web',
      'Mobile',
      'DevOps & Cloud',
      'AI',
      'Games',
      'DevTools',
      'Career',
      'Open Source',
      'DevRel',
      'Fun',
    ];
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    const mapped = res.data.sourceCategories.edges.map(
      ({ node }) => node.title,
    );
    expect(mapped).toEqual(expected);
  });
});

describe('query sources', () => {
  interface Props {
    first: number;
    featured: boolean;
    filterOpenSquads: boolean;
    categoryId: string;
    sortByMembersCount: boolean;
  }

  const QUERY = ({
    first = 10,
    filterOpenSquads = false,
    featured,
    categoryId,
    sortByMembersCount,
  }: Partial<Props> = {}): string => `{
    sources(
      first: ${first},
      filterOpenSquads: ${filterOpenSquads}
      ${isNullOrUndefined(featured) ? '' : `, featured: ${featured}`}
      ${isNullOrUndefined(categoryId) ? '' : `, categoryId: "${categoryId}"`}
      ${isNullOrUndefined(sortByMembersCount) ? '' : `, sortByMembersCount: ${sortByMembersCount}`}
    ) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          name
          image
          headerImage
          public
          type
          color
          flags {
            featured
            totalMembers
          }
          category {
            id
          }
        }
      }
    }
  }`;

  it('should return only public sources', async () => {
    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: true }),
    );
    const isPublic = res.data.sources.edges.every(({ node }) => !!node.public);
    expect(isPublic).toBeTruthy();
  });

  it('should filter by category', async () => {
    const repo = con.getRepository(Source);
    const anyOther = await con
      .getRepository(SourceCategory)
      .findOneByOrFail({ title: Not('Web') });
    const web = await con
      .getRepository(SourceCategory)
      .findOneByOrFail({ title: 'Web' });
    await repo.update({ id: 'a' }, { categoryId: anyOther.id });
    await repo.update({ id: 'b' }, { categoryId: web.id });
    const res = await client.query(QUERY({ first: 10, categoryId: web.id }));
    const isAllWeb = res.data.sources.edges.every(
      ({ node }) => node.category.id === web.id,
    );
    expect(isAllWeb).toBeTruthy();
  });

  const prepareFeaturedTests = async () => {
    const repo = con.getRepository(Source);
    await repo.update(
      { id: 'a' },
      {
        flags: updateFlagsStatement({ featured: true, publicThreshold: true }),
      },
    );
    await repo.update(
      { id: 'b' },
      {
        flags: updateFlagsStatement({ featured: false, publicThreshold: true }),
      },
    );
  };

  it('should return only featured sources', async () => {
    await prepareFeaturedTests();
    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: false, featured: true }),
    );
    const isFeatured = res.data.sources.edges.every(
      ({ node }) => !!node.flags.featured,
    );
    expect(isFeatured).toBeTruthy();
  });

  it('should return public squads that passes the threshold', async () => {
    await prepareFeaturedTests();
    await con.getRepository(Source).update(
      { id: 'a' },
      {
        type: SourceType.Squad,
        private: false,
        flags: updateFlagsStatement<Source>({ publicThreshold: false }),
      },
    );
    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: true }),
    );
    const passedThreshold = res.data.sources.edges.map(({ node }) => node.id);
    expect(passedThreshold).toEqual(expect.arrayContaining(['b']));
  });

  it('should return only non-featured sources - this means when flag is false or undefined', async () => {
    await prepareFeaturedTests();
    await con.getRepository(Source).save(sourcesFixture[2]);
    await con.getRepository(Source).update(
      { id: 'c' },
      {
        type: SourceType.Squad,
        private: false,
        flags: updateFlagsStatement({ publicThreshold: true }),
      },
    );
    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: true, featured: false }),
    );
    expect(res.data.sources.edges.length).toEqual(2);
  });

  it('should return only not featured sources', async () => {
    await prepareFeaturedTests();
    const res = await client.query(
      QUERY({
        first: 10,
        filterOpenSquads: false,
        featured: false,
      }),
    );
    const isNotFeatured = res.data.sources.edges.every(
      ({ node }) => !node.flags.featured,
    );
    expect(isNotFeatured).toBeTruthy();
  });

  it('should flag that more pages available', async () => {
    const res = await client.query(QUERY({ first: 1 }));
    expect(res.data.sources.pageInfo.hasNextPage).toBeTruthy();
  });

  it('should return only active sources', async () => {
    await con.getRepository(Source).save([
      {
        id: 'd',
        active: false,
        name: 'D',
        image: 'http://d.com',
        handle: 'd',
      },
    ]);
    const res = await client.query(QUERY());
    const isActive = res.data.sources.edges.every(
      ({ node }) => node.id !== 'd',
    );
    expect(isActive).toBeTruthy();
  });

  const prepareSquads = async () => {
    const repo = con.getRepository(Source);
    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: true }),
    );
    expect(res.errors).toBeFalsy();

    await repo.update(
      { id: In(['a', 'b']) },
      {
        type: SourceType.Squad,
        private: true,
        flags: updateFlagsStatement({ publicThreshold: true }),
      },
    );
    await repo.update(
      { id: 'b' },
      {
        private: false,
        flags: updateFlagsStatement({ publicThreshold: true }),
      },
    );
  };

  it('should return only public squads', async () => {
    await prepareSquads();

    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: true }),
    );
    expect(res.errors).toBeFalsy();
    expect(res.data.sources.edges.length).toEqual(1);
    const allSquad = res.data.sources.edges.every(
      ({ node }) => node.type === SourceType.Squad && node.public === true,
    );
    expect(allSquad).toBeTruthy();
  });

  it('should return public squad color and headerImage', async () => {
    await prepareSquads();
    const res = await client.query(
      QUERY({ first: 10, filterOpenSquads: true }),
    );
    expect(res.errors).toBeFalsy();
    expect(res.data.sources.edges.length).toEqual(1);
    expect(res.data.sources.edges[0].node.public).toBeTruthy();
    expect(res.data.sources.edges[0].node.color).toEqual('avocado');
    expect(res.data.sources.edges[0].node.headerImage).toEqual(
      'http://image.com/header',
    );
  });

  const saveMembers = (sourceId: string, users: string[]) => {
    const repo = con.getRepository(SourceMember);
    const now = new Date();

    const members = users.map((userId, index) =>
      repo.create({
        userId,
        sourceId,
        referralToken: randomUUID(),
        role: SourceMemberRoles.Member,
        createdAt: new Date(now.getTime() + 1000 * index),
      }),
    );

    return repo.save(members);
  };

  it('should return public squads ordered by members count', async () => {
    await prepareSquads();
    await saveFixtures(con, Source, [sourcesFixture[2]]);
    await con.getRepository(SourceMember).delete({ sourceId: Not('null') });
    await con.getRepository(Source).update(
      { id: Not('null') },
      {
        type: SourceType.Squad,
        flags: updateFlagsStatement({ totalMembers: 0 }),
      },
    );
    await saveMembers('a', ['3']);
    await saveMembers('b', ['1']);
    await saveMembers('c', ['1', '2', '3', '4']);

    const query = QUERY({ first: 10, sortByMembersCount: true });
    const res = await client.query(query);
    expect(res.errors).toBeFalsy();

    expect(res.data.sources.edges.map(({ node }) => node.id)).toEqual([
      'c',
      'a',
      'b',
      'squad',
      'm',
    ]);
  });

  it('should not order by members count without the right parameter', async () => {
    await prepareSquads();
    await saveFixtures(con, Source, [sourcesFixture[2]]);
    await con.getRepository(SourceMember).delete({ sourceId: Not('null') });
    await saveMembers('a', ['3']);
    await saveMembers('b', ['1']);
    await saveMembers('c', ['1', '2', '3', '4']);

    const query = QUERY({ first: 10 });
    const res = await client.query(query);
    expect(res.errors).toBeFalsy();

    expect(res.data.sources.edges.map(({ node }) => node.id)).toEqual(
      expect.arrayContaining(['c', 'squad', 'm', 'a', 'b']),
    );
  });
});

describe('query searchSources', () => {
  const QUERY = `
  query SearchSources($query: String!) {
    searchSources(query: $query) {
      id
      name
      image
    }
  }`;

  it('should return matching sources', async () => {
    await con.getRepository(Source).insert([
      {
        ...sourcesFixture[0],
        id: 'search1',
        handle: 'search_1',
      },
      {
        ...sourcesFixture[1],
        id: 'search2',
        handle: 'search_2',
      },
    ]);
    const res = await client.query(QUERY, { variables: { query: 'sea' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.searchSources).toEqual([
      { id: 'search1', name: 'A', image: 'http://image.com/a' },
      { id: 'search2', name: 'B', image: 'http://image.com/b' },
    ]);
  });
});

describe('query sourceRecommendationByTags', () => {
  beforeEach(async () => {
    await con
      .getRepository(Post)
      .save([postsFixture[0], postsFixture[1], postsFixture[4]]);
    await con.getRepository(PostKeyword).save([
      postKeywordsFixture[0],
      postKeywordsFixture[1],
      postKeywordsFixture[5],
      postKeywordsFixture[6],
      {
        postId: postsFixture[1].id,
        keyword: 'javascript',
      },
    ]);
    await con.manager.query(`UPDATE post_keyword
                             SET status = 'allow'`);
    const materializedViewName =
      con.getRepository(SourceTagView).metadata.tableName;
    await con.query(`REFRESH MATERIALIZED VIEW ${materializedViewName}`);
  });

  const QUERY = `
  query SourceRecommendationByTags($tags: [String]!) {
    sourceRecommendationByTags(tags: $tags) {
      id
      name
      image
    }
  }`;

  it('should return matching sources', async () => {
    const res = await client.query(QUERY, {
      variables: { tags: ['javascript', 'html'] },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourceRecommendationByTags).toEqual([
      { id: 'b', name: 'B', image: 'http://image.com/b' },
      { id: 'a', name: 'A', image: 'http://image.com/a' },
    ]);
  });

  it('should return matching sources excluding private sources', async () => {
    await con.getRepository(Source).update({ id: 'b' }, { private: true });
    const res = await client.query(QUERY, {
      variables: { tags: ['javascript', 'html'] },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourceRecommendationByTags).toEqual([
      { id: 'a', name: 'A', image: 'http://image.com/a' },
    ]);
  });
});

describe('query mostRecentSources', () => {
  const QUERY = `
    query MostRecentSources {
      mostRecentSources {
        id
        name
        image
        public
      }
    }
  `;

  it('should return most recent sources', async () => {
    await con
      .getRepository(Source)
      .update({ id: In(['a', 'b']) }, { type: SourceType.Machine });
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.mostRecentSources).toEqual(
      expect.arrayContaining([
        { id: 'a', name: 'A', image: 'http://image.com/a', public: true },
        { id: 'b', name: 'B', image: 'http://image.com/b', public: true },
      ]),
    );
  });
});

describe('query trendingSources', () => {
  const QUERY = `
    query TrendingSources {
      trendingSources {
        id
        name
        image
        public
      }
    }
  `;

  it('should return most trending sources', async () => {
    await con.getRepository(Post).save(
      new Array(5).fill('a').map((item, index) => {
        return {
          id: `post_${index}`,
          shortId: `post_${index}`,
          title: `Post ${index}`,
          tagsStr: 'tag1',
          upvotes: 10 + index,
          createdAt: new Date(),
          sourceId: 'a',
        };
      }),
    );
    await con.getRepository(Post).save({
      id: `post_6`,
      shortId: `post_6`,
      title: `Post 6`,
      tagsStr: 'tag1',
      upvotes: 10,
      createdAt: new Date(),
      sourceId: 'b',
    });
    await con.query(`REFRESH MATERIALIZED VIEW trending_post`);
    await con.query(`REFRESH MATERIALIZED VIEW trending_source`);

    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      trendingSources: [
        { id: 'a', name: 'A', image: 'http://image.com/a', public: true },
      ],
    });
  });
});

describe('query popularSources', () => {
  const QUERY = `
    query PopularSources {
      popularSources {
        id
        name
        image
        public
      }
    }
  `;

  it('should return most popular sources', async () => {
    await con.getRepository(Post).save(
      new Array(6).fill('a').map((item, index) => {
        return {
          id: `post_${index}`,
          shortId: `post_${index}`,
          title: `Post ${index}`,
          tagsStr: 'tag1',
          upvotes: 10 + index,
          createdAt: new Date(),
          sourceId: 'a',
        };
      }),
    );
    await con.getRepository(Post).save(
      new Array(5).fill('b').map((item, index) => {
        return {
          id: `post_${index}`,
          shortId: `post_${index}`,
          title: `Post ${index}`,
          tagsStr: 'tag1',
          upvotes: 10 + index,
          createdAt: new Date(),
          sourceId: 'a',
        };
      }),
    );
    await con.query(`REFRESH MATERIALIZED VIEW popular_post`);
    await con.query(`REFRESH MATERIALIZED VIEW popular_source`);

    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      popularSources: [
        { id: 'a', name: 'A', image: 'http://image.com/a', public: true },
      ],
    });
  });
});

describe('query topVideoSources', () => {
  const QUERY = `
    query TopVideoSources {
      topVideoSources {
        id
        name
        image
        public
      }
    }
  `;

  it('should return top video sources', async () => {
    await con.getRepository(Post).save(
      new Array(6).fill('a').map((item, index) => {
        return {
          id: `post_a_${index}`,
          shortId: `post_a_${index}`,
          title: `Post ${index}`,
          tagsStr: 'tag1',
          upvotes: 10 + index,
          createdAt: new Date(),
          sourceId: 'a',
          type: PostType.VideoYouTube,
        };
      }),
    );
    await con.getRepository(Post).save(
      new Array(6).fill('b').map((item, index) => {
        return {
          id: `post_b_${index}`,
          shortId: `post_b_${index}`,
          title: `Post ${index}`,
          tagsStr: 'tag1',
          upvotes: 10 + index,
          createdAt: new Date(),
          sourceId: 'b',
        };
      }),
    );
    await con.query(`REFRESH MATERIALIZED VIEW popular_video_post`);
    await con.query(`REFRESH MATERIALIZED VIEW popular_video_source`);

    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchObject({
      topVideoSources: [
        { id: 'a', name: 'A', image: 'http://image.com/a', public: true },
      ],
    });
  });
});

describe('query sourceByFeed', () => {
  const QUERY = `
query SourceByFeed($data: String!) {
  sourceByFeed(feed: $data) {
    id
    name
    image
    public
  }
}`;

  it('should not authorize when not logged in', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { data: 'https://a.com/feed' } },
      'UNAUTHENTICATED',
    ));

  it('should return null when feed does not exist', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { data: 'https://a.com/feed' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourceByFeed).toEqual(null);
  });

  it('should return the source', async () => {
    loggedUser = '1';
    await con.getRepository(SourceFeed).save({
      feed: 'https://a.com/feed',
      sourceId: 'a',
    });
    const res = await client.query(QUERY, {
      variables: { data: 'https://a.com/feed' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourceByFeed).toEqual({
      id: 'a',
      name: 'A',
      image: 'http://image.com/a',
      public: true,
    });
  });
});

describe('query source current member', () => {
  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    id
    currentMember {
      role
      roleRank
      permissions
    }
  }
}
  `;

  it('should return null for annonymous users', async () => {
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.data).toMatchSnapshot();
  });

  it(`should return null for user that's not in the source`, async () => {
    loggedUser = '3';
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.data).toMatchSnapshot();
  });

  it('should return current member as admin', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Admin,
        }),
      },
    );
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.data).toMatchSnapshot();
  });

  it('should return current member as member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Member,
        }),
      },
    );
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.data).toMatchSnapshot();
  });

  it('should return current member as blocked', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.data.source).toBeNull();
  });

  it('should not return post permission in case memberPostingRank is set above user roleRank', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).save({
      id: 'restrictedsquad1',
      handle: 'restrictedsquad1',
      name: 'Restricted Squad',
      memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'restrictedsquad1',
      referenceId: 'restrictedsquad1',
      userId: '1',
      createdAt: new Date(2022, 11, 19),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'restrictedsquadtoken',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
    const res = await client.query(QUERY, {
      variables: { id: 'restrictedsquad1' },
    });
    expect(
      res.data.source.currentMember.permissions.includes(
        SourcePermissions.Post,
      ),
    ).toBe(false);
  });

  it('should not return invite permission in case memberInviteRank is set above user roleRank', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).save({
      id: 'restrictedsquad1',
      handle: 'restrictedsquad1',
      name: 'Restricted Squad',
      memberInviteRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'restrictedsquad1',
      referenceId: 'restrictedsquad1',
      userId: '1',
      createdAt: new Date(2022, 11, 19),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'restrictedsquadtoken',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
    const res = await client.query(QUERY, {
      variables: { id: 'restrictedsquad1' },
    });
    expect(
      res.data.source.currentMember.permissions.includes(
        SourcePermissions.Invite,
      ),
    ).toBe(false);
  });
});

describe('query source', () => {
  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    id
    name
    image
    public
    moderationRequired
  }
}
  `;

  it('should not authorize when source does not exist', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'notexist' } },
      'NOT_FOUND',
    ));

  it('should not return private source when user is not member', async () => {
    loggedUser = '3';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should not return private source when user is blocked', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should return source by id', async () => {
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.data).toMatchSnapshot();
  });

  it('should return private source to source members', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.id).toEqual('a');
  });

  it('should return source by handle', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { handle: 'handle' });
    const res = await client.query(QUERY, { variables: { id: 'handle' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.id).toEqual('a');
  });

  it('should return correct public property when source is private', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { handle: 'handle', private: true });
    const res = await client.query(QUERY, { variables: { id: 'handle' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.public).toEqual(false);
  });

  it('should return public squad referralUrl for logged source member', async () => {
    const QUERY = `
    query Source($id: ID!) {
      source(id: $id) {
        id
        name
        image
        public
        currentMember {
          referralToken
        }
        referralUrl
      }
    }`;
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update(
        { id: 'a' },
        { handle: 'handle', private: false, type: SourceType.Squad },
      );
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'referraltoken1',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
      type: ContentPreferenceType.Source,
    });
    const res = await client.query(QUERY, { variables: { id: 'handle' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.referralUrl).toBe(
      `${process.env.COMMENTS_PREFIX}/squads/handle?cid=squad&userid=1`,
    );
  });

  it('should return private squad referralUrl for logged source member', async () => {
    const QUERY = `
    query Source($id: ID!) {
      source(id: $id) {
        id
        name
        image
        public
        currentMember {
          referralToken
        }
        referralUrl
      }
    }`;
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update(
        { id: 'a' },
        { handle: 'handle', private: true, type: SourceType.Squad },
      );
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'a',
      referenceId: 'a',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'referraltoken1',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
      type: ContentPreferenceType.Source,
    });
    const res = await client.query(QUERY, { variables: { id: 'handle' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.referralUrl).toBe(
      `${process.env.COMMENTS_PREFIX}/squads/handle/referraltoken1`,
    );
  });

  it('should disallow access to public source for blocked members', async () => {
    loggedUser = '1';
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
      type: ContentPreferenceType.Source,
    });

    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { id: 'a' },
      },
      'FORBIDDEN',
    );
  });
});

describe('query source moderation fields', () => {
  beforeEach(async () => {
    await con.getRepository(SquadSource).update(
      { id: 'm' },
      {
        private: false,
        moderationRequired: true,
      },
    );
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'm',
      referenceId: 'm',
      userId: '2',
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: generateUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '2',
      type: ContentPreferenceType.Source,
    });
    await con.getRepository(SourcePostModeration).save({
      sourceId: 'm',
      createdById: '2',
      title: 'Title',
      content: 'Content',
      status: SourcePostModerationStatus.Pending,
      type: PostType.Article,
    });
  });

  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    id
    name
    image
    public
    moderationRequired
    moderationPostCount
    currentMember {
      role
      roleRank
      permissions
    }
  }
}
  `;

  it('should not return moderationPostCount when moderation is not required', async () => {
    loggedUser = '1';
    // squad source have moderationRequired set to false
    const res = await client.query(QUERY, { variables: { id: 'squad' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.moderationRequired).toEqual(false);
    expect(res.data.source.moderationPostCount).toBeFalsy();
  });

  it('should return moderationPostCount when user is admin', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, { variables: { id: 'm' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.moderationRequired).toEqual(true);
    expect(res.data.source.moderationPostCount).toBe(1);
  });

  it('should return moderationPostCount when user is user', async () => {
    loggedUser = '2';
    await con.getRepository(SourcePostModeration).save({
      sourceId: 'm',
      createdById: '2',
      title: 'Title 2',
      content: 'Content 2',
      status: SourcePostModerationStatus.Pending,
      type: PostType.Article,
    });
    const res = await client.query(QUERY, { variables: { id: 'm' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.moderationRequired).toEqual(true);
    expect(res.data.source.moderationPostCount).toBe(2);
  });

  it('should return only my moderationPostCount', async () => {
    loggedUser = '3';
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 'm',
      referenceId: 'm',
      userId: '3',
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: generateUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '3',
      type: ContentPreferenceType.Source,
    });
    const res = await client.query(QUERY, { variables: { id: 'm' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.moderationRequired).toEqual(true);
    // this user has no pending posts waiting for moderation
    expect(res.data.source.moderationPostCount).toBe(0);
  });
});

describe('query sourceHandleExists', () => {
  const QUERY = `
    query SourceHandleExists($handle: String!) {
      sourceHandleExists(handle: $handle)
    }
  `;

  const updateHandle = (handle = 'aaa') =>
    con.getRepository(Source).update({ id: 'a' }, { handle, private: true });

  it('should not authorize when user is not logged in', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { handle: 'aaa' } },
      'UNAUTHENTICATED',
    ));

  it('should throw validation error when the handle did not pass our criteria', () => {
    loggedUser = '3';
    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { handle: 'aa aa' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should return false if the source handle is not taken', async () => {
    loggedUser = '3';
    await updateHandle();
    const res = await client.query(QUERY, { variables: { handle: 'aaaa' } });
    expect(res.data.sourceHandleExists).toBeFalsy();
  });

  it('should return true if the source handle is taken', async () => {
    loggedUser = '3';
    await updateHandle();
    const res = await client.query(QUERY, { variables: { handle: 'aaa' } });
    expect(res.data.sourceHandleExists).toBeTruthy();
  });

  it('should return true if the source handle is not allowed', async () => {
    loggedUser = '3';
    await con.getRepository(DisallowHandle).save({ value: 'disallow' });
    const res = await client.query(QUERY, {
      variables: { handle: 'disallow' },
    });
    expect(res.data.sourceHandleExists).toBeTruthy();
  });

  it('should return true if the source handle is not allowed without case sensitivity', async () => {
    loggedUser = '3';
    await con.getRepository(DisallowHandle).save({ value: 'disallow' });
    const res = await client.query(QUERY, {
      variables: { handle: 'Disallow' },
    });
    expect(res.data.sourceHandleExists).toBeTruthy();
  });

  it('should return true if the source handle is taken considering uppercase characters', async () => {
    loggedUser = '3';
    await updateHandle();
    const res = await client.query(QUERY, { variables: { handle: 'AAA' } });
    expect(res.data.sourceHandleExists).toBeTruthy();
  });
});

describe('members field', () => {
  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    id
    members {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          user { id }
          source { id }
          role
        }
      }
    }
  }
}
  `;

  it('should return source members', async () => {
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should exclude blocked members from result', async () => {
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return source members for private source when the user is a member', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.members).toMatchSnapshot();
  });
});

describe('permalink field', () => {
  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    permalink
  }
}
  `;

  it('should return source url', async () => {
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.permalink).toEqual('http://localhost:5002/squads/a');
  });

  it('should return squad url', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad });
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.permalink).toEqual('http://localhost:5002/squads/a');
  });
});

describe('membersCount field', () => {
  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    membersCount
    flags {
      totalMembers
    }
  }
}
  `;

  it('should return number of members', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.membersCount).toEqual(
      res.data.source.flags.totalMembers,
    );
    expect(res.data.source.membersCount).toEqual(2);
  });

  it('should return number of members excluding blocked members', async () => {
    await con
      .getRepository(SourceMember)
      .update({ userId: '2' }, { role: SourceMemberRoles.Blocked });
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    loggedUser = '1';
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.source.membersCount).toEqual(1);
  });
});

describe('query sourceMembers', () => {
  const QUERY = `
    query SourceMembers($id: ID!, $role: String, $query: String) {
      sourceMembers(sourceId: $id, role: $role, query: $query) {
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            role
            roleRank
            user {
              id
              name
              username
            }
            source { id }
          }
        }
      }
    }
  `;

  it('should not authorize when source does not exist', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'notexist' } },
      'NOT_FOUND',
    ));

  it('should return source members of public source', async () => {
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return source members of public source without blocked members', async () => {
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return source members of source without members that blocked squad', async () => {
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        status: ContentPreferenceStatus.Blocked,
      },
    );
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return source members without blocked members and based on query', async () => {
    const res = await client.query(QUERY, {
      variables: { id: 'a', query: 'i' },
    });
    expect(res.errors).toBeFalsy();
    const [found] = res.data.sourceMembers.edges;
    expect(found.node.user.name).toEqual('Ido');
  });

  it('should return source members based on query with spaces', async () => {
    await con.getRepository(User).update({ id: '1' }, { name: 'Lee Hansel' });
    const res = await client.query(QUERY, {
      variables: { id: 'a', query: 'lee h' },
    });
    expect(res.errors).toBeFalsy();
    const [found] = res.data.sourceMembers.edges;
    expect(found.node.user.id).toEqual('1');
  });

  it('should return source members and order by their role', async () => {
    const repo = con.getRepository(ContentPreferenceSource);
    await repo.update(
      { userId: '3' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Member,
        }),
        sourceId: 'a',
        referenceId: 'a',
      },
    );
    const noModRes = await client.query(QUERY, { variables: { id: 'a' } });
    expect(noModRes.errors).toBeFalsy();
    const [noModFirst, noModSecond, noModThird] =
      noModRes.data.sourceMembers.edges;
    expect(noModFirst.node.role).toEqual(SourceMemberRoles.Admin);
    expect(noModSecond.node.role).toEqual(SourceMemberRoles.Member);
    expect(noModThird.node.role).toEqual(SourceMemberRoles.Member);

    await repo.update(
      { userId: '3' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
        sourceId: 'a',
        referenceId: 'a',
      },
    );

    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    const [first, second, third] = res.data.sourceMembers.edges;
    expect(first.node.role).toEqual(SourceMemberRoles.Admin);
    expect(second.node.role).toEqual(SourceMemberRoles.Moderator);
    expect(third.node.role).toEqual(SourceMemberRoles.Member);
  });

  it('should return source members of private source when user is a member', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    const res = await client.query(QUERY, { variables: { id: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should not return source members of private source when user is not a member', async () => {
    loggedUser = '3';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should not return blocked source members when user is not a moderator/admin', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1', referenceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { role: SourceMemberRoles.Blocked, id: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should return blocked users only when user is the admin', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2', referenceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    const res = await client.query(QUERY, {
      variables: { role: SourceMemberRoles.Blocked, id: 'a' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should return blocked users only when user is a moderator', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2', referenceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1', referenceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.query(QUERY, {
      variables: { role: SourceMemberRoles.Blocked, id: 'a' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should only return referralToken for current logged user', async () => {
    loggedUser = '1';
    const QUERY_WITH_REFERRAL_TOKEN = `
    query SourceMembers($id: ID!, $role: String) {
      sourceMembers(sourceId: $id, role: $role) {
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            role
            roleRank
            user { id }
            source { id }
            referralToken
          }
        }
      }
    }`;
    const res = await client.query(QUERY_WITH_REFERRAL_TOKEN, {
      variables: {
        id: 'a',
      },
    });
    expect(res.errors).toBeFalsy();
    res.data.sourceMembers.edges.forEach(({ node }) => {
      if (node.user.id === loggedUser) {
        expect(node.referralToken).toBeTruthy();
      } else {
        expect(node.referralToken).toBeFalsy();
      }
    });
  });
});

describe('query mySourceMemberships', () => {
  afterEach(async () => {
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2', referenceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Member,
        }),
      },
    );
  });

  const createQuery = (type?: SourceType) => `
    query SourceMemberships {
      mySourceMemberships${type ? `(type: ${type})` : ''} {
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            user { id }
            source { id }
            role
            roleRank
          }
        }
      }
    }
  `;
  const QUERY = createQuery();

  it('should not authorize when user is not logged in', () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return source memberships', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.mySourceMemberships).toBeDefined();
    expect(res.data.mySourceMemberships.edges).toHaveLength(3);
    expect(
      res.data.mySourceMemberships.edges.map(({ node }) => node.source.id),
    ).toEqual(['m', 'squad', 'a']);
  });

  it('should not return source memberships if user is blocked', async () => {
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2', referenceId: 'a' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    loggedUser = '2';
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.mySourceMemberships).toBeDefined();
    expect(res.data.mySourceMemberships.edges).toHaveLength(1);
    expect(
      res.data.mySourceMemberships.edges.map(({ node }) => node.source.id),
    ).toEqual(['b']);
  });

  it('should only return squad type memberships if specified', async () => {
    loggedUser = '1';
    const res = await client.query(createQuery(SourceType.Squad));
    expect(res.errors).toBeFalsy();
    expect(res.data.mySourceMemberships).toBeDefined();
    expect(res.data.mySourceMemberships.edges).toHaveLength(3);
    expect(
      res.data.mySourceMemberships.edges.map(({ node }) => node.source.id),
    ).toEqual(expect.arrayContaining(['a', 'squad']));
  });
});

describe('query publicSourceMemberships', () => {
  const QUERY = `
    query SourceMemberships($userId: ID!) {
      publicSourceMemberships(userId: $userId) {
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            user { id }
            source { id }
            role
            roleRank
          }
        }
      }
    }
  `;

  it('should return source memberships', async () => {
    const res = await client.query(QUERY, { variables: { userId: '2' } });
    expect(res.errors).toBeFalsy();
    const sources = res.data.publicSourceMemberships.edges.map(
      ({ node }) => node.source.id,
    );
    expect(sources).toEqual(['b', 'a']);
  });

  it('should return only public sources', async () => {
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    const res = await client.query(QUERY, { variables: { userId: '2' } });
    expect(res.errors).toBeFalsy();
    const sources = res.data.publicSourceMemberships.edges.map(
      ({ node }) => node.source.id,
    );
    expect(sources).toEqual(['b']);
  });
});

describe('query sourceMemberByToken', () => {
  const QUERY = `
query SourceMemberByToken($token: String!) {
  sourceMemberByToken(token: $token) {
    user { id }
    source { id }
  }
}
  `;

  it('should throw not found exception', () =>
    testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { token: 'notfound' },
      },
      'NOT_FOUND',
    ));

  it('should return source member', async () => {
    const res = await client.query(QUERY, { variables: { token: 'rt' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourceMemberByToken.user.id).toEqual('1');
    expect(res.data.sourceMemberByToken.source.id).toEqual('a');
  });
});

describe('query sourcesByTag', () => {
  const QUERY = `
query SourcesByTag($tag: String!, $first: Int, $excludedSources: [String]) {
  sourcesByTag(tag: $tag, first: $first, excludeSources: $excludedSources) {
    edges {
      node {
        name
      }
    }
  }
}`;

  it('should return empty array if tag not found', async () => {
    const res = await client.query(QUERY, {
      variables: { tag: 'notexist' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourcesByTag.edges).toEqual([]);
  });

  it('should return sources for this tag', async () => {
    await con.getRepository(Post).save([postsFixture[0], postsFixture[4]]);
    await con
      .getRepository(PostKeyword)
      .save([
        postKeywordsFixture[0],
        postKeywordsFixture[1],
        postKeywordsFixture[5],
        postKeywordsFixture[6],
      ]);
    await con.manager.query(`UPDATE post_keyword
                             SET status = 'allow'`);
    const materializedViewName =
      con.getRepository(SourceTagView).metadata.tableName;
    await con.query(`REFRESH MATERIALIZED VIEW ${materializedViewName}`);
    const res = await client.query(QUERY, {
      variables: { tag: 'javascript' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.sourcesByTag.edges).toEqual([
      { node: { name: 'A' } },
      { node: { name: 'B' } },
    ]);
  });
});

describe('query similarSources', () => {
  const QUERY = `
query SimilarSources($sourceId: ID!) {
  similarSources(sourceId: $sourceId) {
    edges {
      node {
        name
      }
    }
  }
}`;

  it('should return empty array if source not found', async () => {
    const res = await client.query(QUERY, {
      variables: { sourceId: 'notexist' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.similarSources.edges).toEqual([]);
  });

  it('should return similar sources for a source', async () => {
    await con.getRepository(Post).save([postsFixture[0], postsFixture[4]]);
    await con
      .getRepository(PostKeyword)
      .save([
        postKeywordsFixture[0],
        postKeywordsFixture[1],
        postKeywordsFixture[5],
        postKeywordsFixture[6],
      ]);
    await con.manager.query(`UPDATE post_keyword
                             SET status = 'allow'`);
    const materializedViewName =
      con.getRepository(SourceTagView).metadata.tableName;
    await con.query(`REFRESH MATERIALIZED VIEW ${materializedViewName}`);
    const res = await client.query(QUERY, { variables: { sourceId: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.similarSources.edges).toEqual([{ node: { name: 'B' } }]);
  });
});

describe('query relatedTags', () => {
  const QUERY = `
query RelatedTags($sourceId: ID!) {
  relatedTags(sourceId: $sourceId) {
    hits {
      name
    }
  }
}`;

  it('should return empty array if source not found', async () => {
    const res = await client.query(QUERY, {
      variables: { sourceId: 'notexist' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.relatedTags.hits).toEqual([]);
  });

  it('should return related tags for a source', async () => {
    await con.getRepository(Post).save([postsFixture[0], postsFixture[4]]);
    await con
      .getRepository(PostKeyword)
      .save([
        postKeywordsFixture[0],
        postKeywordsFixture[1],
        postKeywordsFixture[5],
        postKeywordsFixture[6],
      ]);
    await con.manager.query(`UPDATE post_keyword
                             SET status = 'allow'`);
    const materializedViewName =
      con.getRepository(SourceTagView).metadata.tableName;
    await con.query(`REFRESH MATERIALIZED VIEW ${materializedViewName}`);
    const res = await client.query(QUERY, { variables: { sourceId: 'a' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.relatedTags.hits).toEqual([
      { name: 'javascript' },
      { name: 'webdev' },
    ]);
  });
});

describe('mutation createSquad', () => {
  const MUTATION = `
  mutation CreateSquad($name: String!, $handle: String!, $description: String, $postId: ID!, $commentary: String!, $memberPostingRole: String, $memberInviteRole: String, $categoryId: ID, $isPrivate: Boolean, $moderationRequired: Boolean) {
  createSquad(name: $name, handle: $handle, description: $description, postId: $postId, commentary: $commentary, memberPostingRole: $memberPostingRole, memberInviteRole: $memberInviteRole, categoryId: $categoryId, isPrivate: $isPrivate, moderationRequired: $moderationRequired) {
    id
    category { id }
  }
}`;

  const variables = {
    name: 'Squad Create Test',
    handle: 'squadcreatetest',
    postId: 'p1',
    commentary: 'My comment',
  };

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('squad should have post moderation enabled on creation', async () => {
    loggedUser = '1';

    await con.getRepository(Post).save(postsFixture[0]);

    const res = await client.query(MUTATION, {
      variables: { ...variables, moderationRequired: true },
    });
    expect(res.errors).toBeFalsy();

    const newId = res.data.createSquad.id;
    const newSource = await con
      .getRepository(SquadSource)
      .findOneByOrFail({ id: newId });

    expect(newSource.moderationRequired).toEqual(true);
  });

  it('should create squad', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const newId = res.data.createSquad.id;
    const newSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: newId });
    expect(newSource.name).toEqual(variables.name);
    expect(newSource.handle).toEqual(variables.handle);
    expect(newSource.active).toEqual(true);
    expect(newSource?.memberPostingRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Member],
    );
    expect(newSource?.memberInviteRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Member],
    );
    expect(newSource?.moderationRequired).toEqual(false);
    const member = await con.getRepository(ContentPreferenceSource).findOneBy({
      referenceId: newId,
      sourceId: newId,
      userId: '1',
    });
    expect(member?.flags.role).toEqual(SourceMemberRoles.Admin);
    const sharePost = await con
      .getRepository(SharePost)
      .findOneBy({ sourceId: newId });
    expect(sharePost.authorId).toEqual('1');
    expect(sharePost.sharedPostId).toEqual('p1');
    expect(sharePost.title).toEqual('My comment');

    const welcomePost = await con
      .getRepository(WelcomePost)
      .findOneBy({ sourceId: newId });
    expect(welcomePost.authorId).toEqual('1');
    expect(welcomePost.title).toEqual(WELCOME_POST_TITLE);
  });

  it('should throw error on duplicate handles', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).save({
      id: randomUUID(),
      handle: variables.handle,
      name: 'Dup squad',
      active: false,
    });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error on disallowed handles', async () => {
    loggedUser = '1';
    await con.getRepository(DisallowHandle).save({
      value: variables.handle,
    });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when post does not exist', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'FORBIDDEN',
    );
  });

  it('should throw error when handle is invalid', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, handle: 'inv()8&*^' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should lowercase handle', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, handle: '@HANDLE' },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.createSquad.id;
    const newSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: newId });
    expect(newSource.handle).toEqual('handle');
  });

  it('should limit name length', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, name: new Array(70).join('a') },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should limit description length', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, description: new Array(260).join('a') },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when invalid role is provided for posting', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, memberPostingRole: 'invalidRole' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when null is sent to memberPostingRole', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).save({
      id: randomUUID(),
      handle: variables.handle,
      name: 'Dup squad',
      active: false,
      memberPostingRole: null,
    });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should create squad with memberPostingRank', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        moderationRequired: false,
        memberPostingRole: SourceMemberRoles.Moderator,
      },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.createSquad.id;
    const newSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: newId });
    expect(newSource.name).toEqual(variables.name);
    expect(newSource.handle).toEqual(variables.handle);
    expect(newSource.active).toEqual(true);
    expect(newSource?.memberPostingRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Moderator],
    );
    const member = await con.getRepository(ContentPreferenceSource).findOneBy({
      referenceId: newId,
      sourceId: newId,
      userId: '1',
    });
    expect(member?.flags.role).toEqual(SourceMemberRoles.Admin);
    const post = await con
      .getRepository(SharePost)
      .findOneBy({ sourceId: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });

  it('should throw error when invalid role is provided for inviting', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, memberInviteRole: 'invalidRole' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when null is sent to memberInviteRole', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).save({
      id: randomUUID(),
      handle: variables.handle,
      name: 'Dup squad',
      active: false,
      memberInviteRole: null,
    });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when category id is not found', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, categoryId: 'random' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update category id when squad is private', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const [sample] = await con.getRepository(SourceCategory).find();
    expect(sample).not.toBeNull();
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, categoryId: sample.id },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSquad.category).toBeNull();
  });

  it('should update category id', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const [sample] = await con.getRepository(SourceCategory).find();
    expect(sample).not.toBeNull();
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, categoryId: sample.id, isPrivate: false },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.createSquad.category.id).toEqual(sample.id);
  });

  it('should create squad with memberInviteRole', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        memberInviteRole: SourceMemberRoles.Moderator,
      },
    });
    expect(res.errors).toBeFalsy();
    const newId = res.data.createSquad.id;
    const newSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: newId });
    expect(newSource.name).toEqual(variables.name);
    expect(newSource.handle).toEqual(variables.handle);
    expect(newSource.active).toEqual(true);
    expect(newSource?.memberInviteRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Moderator],
    );
    const member = await con.getRepository(ContentPreferenceSource).findOneBy({
      referenceId: newId,
      sourceId: newId,
      userId: '1',
    });
    expect(member?.flags.role).toEqual(SourceMemberRoles.Admin);
    const post = await con
      .getRepository(SharePost)
      .findOneBy({ sourceId: newId });
    expect(post.authorId).toEqual('1');
    expect(post.sharedPostId).toEqual('p1');
    expect(post.title).toEqual('My comment');
  });
});

describe('mutation editSquad', () => {
  const MUTATION = `
  mutation EditSquad($sourceId: ID!, $name: String!, $handle: String!, $description: String, $memberPostingRole: String, $memberInviteRole: String, $isPrivate: Boolean, $categoryId: ID, $moderationRequired: Boolean) {
  editSquad(sourceId: $sourceId, name: $name, handle: $handle, description: $description, memberPostingRole: $memberPostingRole, memberInviteRole: $memberInviteRole, isPrivate: $isPrivate, categoryId: $categoryId, moderationRequired: $moderationRequired) {
    id
    category { id }
  }
}`;

  const variables = {
    sourceId: 's1',
    handle: 's1',
    name: 'Squad',
    description: null,
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Admin,
    });
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: 's1',
      referenceId: 's1',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'rt2',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
  });

  it('squad should have post moderation enabled after update', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        memberPostingRole: SourceMemberRoles.Member,
        moderationRequired: true,
      },
    });

    expect(res.errors).toBeFalsy();

    const squad = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(squad?.moderationRequired).toEqual(true);
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should edit squad', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, name: 'test' },
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource.name).toEqual('test');
  });

  it('should edit squad to public even if no request was approved', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables: { ...variables, name: 'test', isPrivate: false },
    });

    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource!.private).toBeFalsy();
  });

  it('should ignore null private value and edit squad', async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, {
      variables: { ...variables, name: 'test', isPrivate: null },
    });

    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource.name).toEqual('test');
    expect(editSource.private).toBeTruthy();
  });

  it("should not change squad's private status if variable is not found", async () => {
    loggedUser = '1';

    const res = await client.mutate(MUTATION, { variables });

    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource.private).toBeTruthy();
  });

  it('should edit squad privacy status if the user has been approved before', async () => {
    loggedUser = '1';

    await con
      .getRepository(SquadSource)
      .update({ id: variables.sourceId }, { private: true });
    await con.getRepository(SquadPublicRequest).save({
      sourceId: variables.sourceId,
      requestorId: '1',
      status: SquadPublicRequestStatus.Approved,
    });

    const res = await client.mutate(MUTATION, {
      variables: { ...variables, isPrivate: false },
    });

    expect(res.errors).toBeFalsy();

    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource.private).toBeFalsy();
  });

  it('should edit squad description with new lines', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, description: 'test \n something more' },
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource.description).toEqual('test \n something more');
  });

  it('should throw error on duplicate handles', async () => {
    loggedUser = '1';
    await con.getRepository(SquadSource).save({
      id: randomUUID(),
      handle: 'existing',
      name: 'Dup squad',
      active: false,
    });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, handle: 'existing' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error on disallow handles', async () => {
    loggedUser = '1';
    await con.getRepository(DisallowHandle).save({
      value: 'existing',
    });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, handle: 'existing' } },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not throw error on disallow handles if the value did not change', async () => {
    loggedUser = '1';
    const handle = 'existing';
    await con.getRepository(Source).update({ id: 's1' }, { handle });
    await con.getRepository(DisallowHandle).save({ value: handle });
    const description = 'New description';
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        handle: 'existing',
        description,
      },
    });

    expect(res.errors).toBeFalsy();
    const edited = await con.getRepository(SquadSource).findOneBy({ handle });
    expect(edited.description).toEqual(description);
  });

  it(`should throw error if squad doesn't exist`, async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { ...variables, sourceId: 'fake' } },
      'NOT_FOUND',
    );
  });

  it(`should throw error if user is not the squad admin`, async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Member,
        }),
      },
    );
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'FORBIDDEN',
    );
  });

  it('should throw error when invalid role is provided for posting', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, memberPostingRole: 'invalidRole' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when null is sent to memberPostingRole', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, memberPostingRole: null },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should edit squad memberPostingRank', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        memberPostingRole: SourceMemberRoles.Moderator,
      },
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource?.memberPostingRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Moderator],
    );
  });

  it('should leave squad memberPostingRank unchanged if not sent during edit', async () => {
    loggedUser = '1';
    await con
      .getRepository(SquadSource)
      .update(
        { id: 's1' },
        { memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator] },
      );
    const res = await client.mutate(MUTATION, {
      variables,
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource?.memberPostingRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Moderator],
    );
  });

  it('should leave squad memberPostingRank unchanged when setting other fields', async () => {
    loggedUser = '1';
    await con
      .getRepository(SquadSource)
      .update(
        { id: 's1' },
        { memberPostingRank: sourceRoleRank[SourceMemberRoles.Admin] },
      );
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, name: 'updated name' },
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource?.memberPostingRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Admin],
    );
    expect(editSource?.name).toEqual('updated name');
  });

  it('should throw error when invalid role is provided for inviting', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, memberInviteRole: 'invalidRole' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when null is sent to memberInviteRole', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, memberInviteRole: null },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should throw error when category id is not found', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { ...variables, categoryId: 'random' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not update category id when squad is private', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const [sample] = await con.getRepository(SourceCategory).find();
    expect(sample).not.toBeNull();
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, categoryId: sample.id, isPrivate: true },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.editSquad.category).toBeNull();
  });

  it('should update category id', async () => {
    loggedUser = '1';
    await con.getRepository(Post).save(postsFixture[0]);
    const [sample] = await con.getRepository(SourceCategory).find();
    expect(sample).not.toBeNull();
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, categoryId: sample.id, isPrivate: false },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.editSquad.category.id).toEqual(sample.id);
  });

  it('should edit squad memberInviteRank', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        memberInviteRole: SourceMemberRoles.Moderator,
      },
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource?.memberInviteRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Moderator],
    );
  });

  it('should leave squad memberInviteRank unchanged if not sent during edit', async () => {
    loggedUser = '1';
    await con
      .getRepository(SquadSource)
      .update(
        { id: 's1' },
        { memberInviteRank: sourceRoleRank[SourceMemberRoles.Moderator] },
      );
    const res = await client.mutate(MUTATION, {
      variables,
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource?.memberInviteRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Moderator],
    );
  });

  it('should leave squad memberInviteRank unchanged when setting other fields', async () => {
    loggedUser = '1';
    await con
      .getRepository(SquadSource)
      .update(
        { id: 's1' },
        { memberInviteRank: sourceRoleRank[SourceMemberRoles.Admin] },
      );
    const res = await client.mutate(MUTATION, {
      variables: { ...variables, name: 'updated name' },
    });
    expect(res.errors).toBeFalsy();
    const editSource = await con
      .getRepository(SquadSource)
      .findOneBy({ id: variables.sourceId });
    expect(editSource?.memberInviteRank).toEqual(
      sourceRoleRank[SourceMemberRoles.Admin],
    );
    expect(editSource?.name).toEqual('updated name');
  });
});

describe('mutation updateMemberRole', () => {
  const MUTATION = `
    mutation UpdateMemberRole($sourceId: ID!, $memberId: ID!, $role: String!) {
      updateMemberRole(sourceId: $sourceId, memberId: $memberId, role: $role) {
        _
      }
    }
  `;

  beforeEach(async () => {
    await con.getRepository(SourceMember).save({
      userId: '3',
      sourceId: 'a',
      role: SourceMemberRoles.Member,
      referralToken: randomUUID(),
      createdAt: new Date(2022, 11, 20),
    });
    await con.getRepository(ContentPreferenceSource).save([
      {
        userId: '2',
        sourceId: 'a',
        referenceId: 'a',
        feedId: '1',
        status: ContentPreferenceStatus.Subscribed,
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: randomUUID(),
        },
      },
      {
        userId: '3',
        sourceId: 'a',
        referenceId: 'a',
        feedId: '1',
        status: ContentPreferenceStatus.Subscribed,
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: randomUUID(),
        },
      },
    ]);
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'a',
          memberId: '2',
          role: SourceMemberRoles.Member,
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should restrict when not a member of the squad', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'b',
          memberId: '2',
          role: SourceMemberRoles.Member,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should restrict member updating another member to a new role', async () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'a',
          memberId: '3',
          role: SourceMemberRoles.Moderator,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should restrict moderator updating another member to a new role', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'a',
          memberId: '3',
          role: SourceMemberRoles.Moderator,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should allow admin to promote a member to moderator', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Moderator,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Moderator);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Moderator);
  });

  it('should allow admin to promote a moderator to an admin', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Admin,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Admin);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Admin);
  });

  it('should allow admin to demote an admin to a moderator', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Moderator,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Moderator);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Moderator);
  });

  it('should allow admin to demote a moderator to a member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Member,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Member);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Member);
  });

  it('should allow admin to remove and block an admin', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Admin,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Blocked,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Blocked);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Blocked);
  });

  it('should allow admin to remove and block a moderator', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Blocked,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Blocked);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Blocked);
  });

  it('should allow admin to remove and block a member', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '2',
        role: SourceMemberRoles.Blocked,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '2', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Blocked);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '2', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Blocked);
  });

  it('should restrict moderator to remove and block a moderator', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '3' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'a',
          memberId: '3',
          role: SourceMemberRoles.Blocked,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should restrict moderator to remove and block an admin', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'a',
          memberId: '1',
          role: SourceMemberRoles.Blocked,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should allow moderator to remove and block a member', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: {
        sourceId: 'a',
        memberId: '3',
        role: SourceMemberRoles.Blocked,
      },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '3', sourceId: 'a' });
    expect(member.role).toEqual(SourceMemberRoles.Blocked);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '3', referenceId: 'a' });
    expect(contentPreference!.flags.role).toEqual(SourceMemberRoles.Blocked);
  });
});

describe('mutation unblockMember', () => {
  const MUTATION = `
    mutation UnblockMember($sourceId: ID!, $memberId: ID!) {
      unblockMember(sourceId: $sourceId, memberId: $memberId) {
        _
      }
    }
  `;

  beforeEach(async () => {
    await con.getRepository(SourceMember).save({
      userId: '3',
      sourceId: 'a',
      role: SourceMemberRoles.Blocked,
      referralToken: randomUUID(),
      createdAt: new Date(2022, 11, 20),
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '3',
      sourceId: 'a',
      referenceId: 'a',
      feedId: '1',
      status: ContentPreferenceStatus.Blocked,
      flags: {
        role: SourceMemberRoles.Blocked,
        referralToken: randomUUID(),
      },
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId: 'a', memberId: '3' },
      },
      'UNAUTHENTICATED',
    ));

  it('should restrict when not a member of the squad', async () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId: 'b', memberId: '3' },
      },
      'FORBIDDEN',
    );
  });

  it('should restrict member unblock another member', async () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId: 'a', memberId: '3' },
      },
      'FORBIDDEN',
    );
  });

  it('should allow moderator to unblock a member', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Moderator,
        }),
      },
    );
    const res = await client.mutate(MUTATION, {
      variables: { sourceId: 'a', memberId: '3' },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '3', sourceId: 'a' });
    expect(member).toBeFalsy();

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '3', referenceId: 'a' });
    expect(contentPreference).toBeNull();
  });

  it('should allow admin to unblock a member', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { sourceId: 'a', memberId: '3' },
    });
    expect(res.errors).toBeFalsy();
    const member = await con
      .getRepository(SourceMember)
      .findOneBy({ userId: '3', sourceId: 'a' });
    expect(member).toBeFalsy();

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '3', referenceId: 'a' });
    expect(contentPreference).toBeNull();
  });
});

describe('mutation leaveSource', () => {
  const MUTATION = `
  mutation LeaveSource($sourceId: ID!) {
  leaveSource(sourceId: $sourceId) {
    _
  }
}`;

  const variables = {
    sourceId: 's1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should leave squad if user is a member', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const sourceMembers = await con
      .getRepository(SourceMember)
      .countBy(variables);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference).toBeNull();

    expect(sourceMembers).toEqual(0);
  });

  it('should leave squad even if the user is the admin', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Admin,
        }),
      },
    );
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const sourceMembers = await con
      .getRepository(SourceMember)
      .countBy(variables);
    expect(sourceMembers).toEqual(0);

    const contentPreferences = await con
      .getRepository(ContentPreferenceSource)
      .countBy(variables);
    expect(contentPreferences).toEqual(0);

    expect(sourceMembers).toEqual(0);
  });
});

describe('mutation deleteSource', () => {
  const MUTATION = `
  mutation DeleteSource($sourceId: ID!) {
  deleteSource(sourceId: $sourceId) {
    _
  }
}`;

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
      active: false,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
      type: ContentPreferenceType.Source,
    });
  });

  const variables = {
    sourceId: 's1',
  };

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should not delete source if user is not the admin', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'FORBIDDEN',
    );
  });

  it('should delete source and members', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Admin,
        }),
      },
    );

    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    const sourceMembers = await con
      .getRepository(SourceMember)
      .countBy(variables);
    expect(sourceMembers).toEqual(0);

    const contentPreferences = await con
      .getRepository(ContentPreferenceSource)
      .countBy(variables);
    expect(contentPreferences).toEqual(0);

    const source = await con.getRepository(SquadSource).countBy({ id: 's1' });
    expect(source).toEqual(0);
  });
});

describe('mutation joinSource', () => {
  const MUTATION = `
  mutation JoinSource($sourceId: ID!, $token: String) {
  joinSource(sourceId: $sourceId, token: $token) {
    id
  }
}`;

  const variables = {
    sourceId: 's1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '2',
      referralToken: 'rt2',
      role: SourceMemberRoles.Admin,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '2',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '2',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'rt2',
      },
      type: ContentPreferenceType.Source,
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should add member to public squad without token', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 's1' }, { private: false });
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    expect(res.data.joinSource.id).toEqual('s1');
    await con.getRepository(SourceMember).findOneByOrFail({
      sourceId: 's1',
      userId: '1',
    });
    await con.getRepository(ContentPreferenceSource).findOneByOrFail({
      userId: '1',
      sourceId: 's1',
      referenceId: 's1',
    });
  });

  it('should add member to private squad with token', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 's1' }, { active: false });
    const res = await client.mutate(MUTATION, {
      variables: {
        ...variables,
        token: 'rt2',
      },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.joinSource.id).toEqual('s1');
    await con.getRepository(SourceMember).findOneByOrFail({
      sourceId: 's1',
      userId: '1',
    });
    await con.getRepository(ContentPreferenceSource).findOneByOrFail({
      userId: '1',
      sourceId: 's1',
      referenceId: 's1',
    });
    const source = await con.getRepository(Source).findOneBy({ id: 's1' });
    expect(source.active).toEqual(true);
    const preference = await con
      .getRepository(NotificationPreferenceSource)
      .findOneBy({
        userId: '1',
        referenceId: 's1',
        notificationType: NotificationType.SquadPostAdded,
      });
    expect(preference).toBeFalsy();

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        userId: '1',
        referenceId: 's1',
      });
    expect(contentPreference).toMatchObject({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: expect.any(String),
      },
    });
  });

  it('should succeed if an existing member tries to join again', async () => {
    loggedUser = '2';
    await con.getRepository(Source).update({ id: 's1' }, { private: false });
    const res = await client.mutate(MUTATION, { variables });
    expect(res.errors).toBeFalsy();
    expect(res.data.joinSource.id).toEqual('s1');
    const member = await con.getRepository(SourceMember).findOneByOrFail({
      sourceId: 's1',
      userId: '2',
    });
    expect(member.role).toEqual(SourceMemberRoles.Admin);
    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneByOrFail({
        userId: '2',
        sourceId: 's1',
        referenceId: 's1',
      });
    expect(contentPreference.flags.role).toEqual(SourceMemberRoles.Admin);
  });

  it('should throw error when joining private squad without token', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'FORBIDDEN',
    );
  });

  it('should throw error when joining private squad when blocked', async () => {
    loggedUser = '2';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '2' },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables },
      'FORBIDDEN',
    );
  });

  it('should throw error when joining private squad with wrong token', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          ...variables,
          token: 'rt3',
        },
      },
      'FORBIDDEN',
    );
  });

  it('should throw error when joining non squad source', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Machine });
    return testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { sourceId: 'a' } },
      'FORBIDDEN',
    );
  });

  it('should throw error when source does not exist', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 'nope',
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when joining with invite link of a member without invite permission', async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
      memberInviteRank: sourceRoleRank[SourceMemberRoles.Moderator],
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '2',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '2',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
      type: ContentPreferenceType.Source,
    });

    loggedUser = '1';
    await testMutationError(
      client,
      {
        mutation: MUTATION,
        variables: {
          sourceId: 's1',
          token: 'rt2',
        },
      },
      (errors) => {
        expect(errors.length).toEqual(1);
        expect(errors[0].extensions?.code).toEqual('FORBIDDEN');
        expect(errors[0].message).toEqual(
          SourcePermissionErrorKeys.InviteInvalid,
        );
      },
    );
  });
});

describe('query source members', () => {
  const QUERY = `
query Source($id: ID!) {
  source(id: $id) {
    id
    privilegedMembers {
      user {
        id
      }
      role
    }
  }
}
  `;

  beforeEach(async () => {
    await con
      .getRepository(Source)
      .save([createSource('c', 'C', 'http://c.com')]);
    await saveFixtures(con, User, usersFixture);

    const now = new Date(2022, 11, 19);

    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'c',
        referenceId: 'c',
        userId: '1',
        createdAt: new Date(now.getTime() + 0),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: randomUUID(),
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 'c',
        referenceId: 'c',
        userId: '2',
        createdAt: new Date(now.getTime() + 1000),
        flags: {
          role: SourceMemberRoles.Moderator,
          referralToken: randomUUID(),
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
      {
        sourceId: 'c',
        referenceId: 'c',
        userId: '3',
        createdAt: new Date(now.getTime() + 2000),
        flags: {
          role: SourceMemberRoles.Moderator,
          referralToken: randomUUID(),
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
      {
        sourceId: 'c',
        referenceId: 'c',
        userId: '4',
        createdAt: new Date(now.getTime() + 3000),
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: randomUUID(),
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '4',
      },
    ]);
  });

  it('should return null for annonymous users', async () => {
    const res = await client.query(QUERY, { variables: { id: 'c' } });
    expect(res.data).toMatchObject({
      source: {
        id: 'c',
        privilegedMembers: null,
      },
    });
  });

  it('should return current members', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, { variables: { id: 'c' } });
    expect(res.data).toMatchObject({
      source: {
        id: 'c',
        privilegedMembers: [
          {
            role: 'admin',
            user: {
              id: '1',
            },
          },
          {
            role: 'moderator',
            user: {
              id: '2',
            },
          },
          {
            role: 'moderator',
            user: {
              id: '3',
            },
          },
        ],
      },
    });
  });
});

describe('mutation hideSourceFeedPosts', () => {
  const MUTATION = `
    mutation HideSourceFeedPosts($sourceId: ID!) {
    hideSourceFeedPosts(sourceId: $sourceId) {
      _
    }
  }`;

  const variables = {
    sourceId: 's1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should throw when user is not a member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).delete({
      sourceId: 's1',
      referenceId: 's1',
      userId: '1',
    });
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should throw when user is blocked', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      {
        sourceId: 's1',
        referenceId: 's1',
        userId: '1',
      },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should set flags.hideFeedPosts to true', async () => {
    loggedUser = '1';
    let sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember).toBeTruthy();
    expect(sourceMember?.flags.hideFeedPosts).toEqual(undefined);

    await client.mutate(MUTATION, { variables: { sourceId: 's1' } });
    sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember?.flags.hideFeedPosts).toEqual(true);

    const contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.hideFeedPosts).toEqual(true);
  });
});

describe('mutation showSourceFeedPosts', () => {
  const MUTATION = `
    mutation ShowSourceFeedPosts($sourceId: ID!) {
      showSourceFeedPosts(sourceId: $sourceId) {
      _
    }
  }`;

  const variables = {
    sourceId: 's1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should throw when user is not a member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).delete({
      sourceId: 's1',
      referenceId: 's1',
      userId: '1',
    });
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should throw when user is blocked', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      {
        sourceId: 's1',
        referenceId: 's1',
        userId: '1',
      },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should set flags.hideFeedPosts to false', async () => {
    loggedUser = '1';
    let sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember).toBeTruthy();
    expect(sourceMember?.flags.hideFeedPosts).toEqual(undefined);

    let contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.hideFeedPosts).toEqual(undefined);

    await client.mutate(MUTATION, { variables: { sourceId: 's1' } });
    sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember?.flags.hideFeedPosts).toEqual(false);

    contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.hideFeedPosts).toEqual(false);
  });
});

describe('mutation collapsePinnedPosts', () => {
  const MUTATION = `
    mutation CollapsePinnedPosts($sourceId: ID!) {
      collapsePinnedPosts(sourceId: $sourceId) {
        _
      }
  }`;

  const variables = {
    sourceId: 's1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should throw when user is not a member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).delete({
      sourceId: 's1',
      referenceId: 's1',
      userId: '1',
    });
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should throw when user is blocked', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      {
        sourceId: 's1',
        referenceId: 's1',
        userId: '1',
      },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should set flags.collapsePinnedPosts to true', async () => {
    loggedUser = '1';
    let sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember).toBeTruthy();
    expect(sourceMember?.flags.collapsePinnedPosts).toEqual(undefined);

    let contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.collapsePinnedPosts).toEqual(undefined);

    await client.mutate(MUTATION, { variables: { sourceId: 's1' } });
    sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember?.flags.collapsePinnedPosts).toEqual(true);

    contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.collapsePinnedPosts).toEqual(true);
  });
});

describe('mutation expandPinnedPosts', () => {
  const MUTATION = `
    mutation ExpandPinnedPosts($sourceId: ID!) {
      expandPinnedPosts(sourceId: $sourceId) {
      _
    }
  }`;

  const variables = {
    sourceId: 's1',
  };

  beforeEach(async () => {
    await con.getRepository(SquadSource).save({
      id: 's1',
      handle: 's1',
      name: 'Squad',
      private: true,
    });
    await con.getRepository(SourceMember).save({
      sourceId: 's1',
      userId: '1',
      referralToken: 'rt2',
      role: SourceMemberRoles.Member,
    });
    await con.getRepository(ContentPreferenceSource).save({
      userId: '1',
      referenceId: 's1',
      sourceId: 's1',
      feedId: '1',
      status: ContentPreferenceStatus.Subscribed,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
    });
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'UNAUTHENTICATED',
    ));

  it('should throw when user is not a member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).delete({
      sourceId: 's1',
      referenceId: 's1',
      userId: '1',
    });
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should throw when user is blocked', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      {
        sourceId: 's1',
        referenceId: 's1',
        userId: '1',
      },
      {
        flags: updateFlagsStatement<ContentPreferenceSource>({
          role: SourceMemberRoles.Blocked,
        }),
      },
    );
    await testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables,
      },
      'FORBIDDEN',
    );
  });

  it('should set flags.collapsePinnedPosts to false', async () => {
    loggedUser = '1';
    let sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember).toBeTruthy();
    expect(sourceMember?.flags.collapsePinnedPosts).toEqual(undefined);

    let contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.collapsePinnedPosts).toEqual(undefined);

    await client.mutate(MUTATION, { variables: { sourceId: 's1' } });
    sourceMember = await con.getRepository(SourceMember).findOneBy({
      sourceId: 's1',
      userId: '1',
    });
    expect(sourceMember?.flags.collapsePinnedPosts).toEqual(false);

    contentPreference = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({ userId: '1', referenceId: 's1' });
    expect(contentPreference!.flags.collapsePinnedPosts).toEqual(false);
  });
});

describe('SourceMember flags field', () => {
  const QUERY = `{
    source(id: "a") {
      currentMember {
        flags {
          hideFeedPosts
          collapsePinnedPosts
        }
      }
    }
  }`;

  it('should return all the public flags for source member', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).update(
      { userId: '1', referenceId: 'a' },
      {
        flags: updateFlagsStatement({
          hideFeedPosts: true,
          collapsePinnedPosts: true,
        }),
      },
    );
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.source.currentMember.flags).toEqual({
      hideFeedPosts: true,
      collapsePinnedPosts: true,
    });
  });

  it('should return null values for unset flags', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY);
    expect(res.data.source.currentMember.flags).toEqual({
      hideFeedPosts: null,
      collapsePinnedPosts: null,
    });
  });
});

describe('Source flags field', () => {
  const QUERY = `{
    source(id: "a") {
      flags {
        featured
        totalViews
        totalPosts
        totalUpvotes
        totalMembers
      }
    }
  }`;

  it('should return all the public flags for source', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update(
      { id: 'a' },
      {
        flags: updateFlagsStatement<Source>({
          featured: true,
        }),
      },
    );
    const res = await client.query(QUERY);
    expect(res.errors).toBeFalsy();
    expect(res.data.source.flags).toEqual({
      ...defaultPublicSourceFlags,
      totalMembers: 2,
      featured: true,
    });
  });

  it('should return default values for unset flags', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { flags: {} });
    const res = await client.query(QUERY);
    expect(res.data.source.flags).toEqual(defaultPublicSourceFlags);
  });
});
