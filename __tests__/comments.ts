import {
  disposeGraphQLTesting,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  saveFixtures,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import {
  Post,
  PostTag,
  Source,
  Comment,
  User,
  ArticlePost,
  SourceType,
  CommentMention,
  Feed,
} from '../src/entity';
import { SourceMemberRoles } from '../src/roles';
import { sourcesFixture } from './fixture/source';
import {
  postsFixture,
  postTagsFixture,
  sharedPostsFixture,
} from './fixture/post';
import { getMentionLink } from '../src/common/markdown';
import {
  saveComment,
  SortCommentsBy,
  updateMentions,
} from '../src/schema/comments';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import { CommentReport } from '../src/entity/CommentReport';
import { UserComment } from '../src/entity/user/UserComment';
import { UserVote, UserVoteEntity } from '../src/types';
import { rateLimiterName } from '../src/directive/rateLimit';
import {
  deleteKeysByPattern,
  getRedisObject,
  getRedisObjectExpiry,
} from '../src/redis';
import { badUsersFixture } from './fixture';
import { ContentPreferenceStatus } from '../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';

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
});

const usersFixture = [
  { id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' },
  { id: '2', name: 'Tsahi', image: 'https://daily.dev/tsahi.jpg' },
  { id: '3', name: 'Nimrod', image: 'https://daily.dev/nimrod.jpg' },
  { id: '4', name: 'Lee', image: 'https://daily.dev/lee.jpg' },
  { id: '5', name: 'Hansel', image: 'https://daily.dev/Hansel.jpg' },
  { id: '6', name: 'Samson', image: 'https://daily.dev/samson.jpg' },
  { id: '7', name: 'Solevilla', image: 'https://daily.dev/solevilla.jpg' },
];

beforeEach(async () => {
  loggedUser = null;
  jest.resetAllMocks();

  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, ArticlePost, postsFixture);
  await saveFixtures(con, ArticlePost, sharedPostsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
  await con.getRepository(User).save(usersFixture);
  await saveFixtures(
    con,
    Feed,
    usersFixture.map((item) => ({ id: item.id, userId: item.id })),
  );
  await con.getRepository(User).save(badUsersFixture);
  await con.getRepository(Comment).save([
    {
      id: 'c1',
      postId: 'p1',
      userId: '1',
      content: 'parent comment',
      contentHtml: '<p>parent comment</p>',
      createdAt: new Date(2020, 1, 6, 0, 0),
    },
    {
      id: 'c2',
      parentId: 'c1',
      postId: 'p1',
      userId: '1',
      content: 'child comment',
      contentHtml: '<p>child comment</p>',
      createdAt: new Date(2020, 1, 7, 0, 0),
    },
    {
      id: 'c3',
      postId: 'p1',
      userId: '2',
      content: 'parent comment #2',
      contentHtml: '<p>parent comment #2</p>',
      createdAt: new Date(2020, 1, 8, 0, 0),
    },
    {
      id: 'c4',
      postId: 'p2',
      userId: '3',
      content: 'parent comment #3',
      contentHtml: '<p>parent comment #3</p>',
      createdAt: new Date(2020, 1, 9, 0, 0),
    },
    {
      id: 'c5',
      postId: 'p2',
      parentId: 'c4',
      userId: '1',
      content: 'child comment #2',
      contentHtml: '<p>child comment #2</p>',
      createdAt: new Date(2020, 1, 10, 0, 0),
    },
    {
      id: 'c6',
      postId: 'p1',
      userId: '3',
      content: 'parent comment #4',
      contentHtml: '<p>parent comment #4</p>',
      createdAt: new Date(2020, 1, 9, 0, 0),
    },
    {
      id: 'c7',
      postId: 'p1',
      parentId: 'c6',
      userId: '2',
      content: 'child comment #3',
      contentHtml: '<p>child comment #3</p>',
      createdAt: new Date(2020, 1, 10, 0, 0),
    },
    {
      id: 'c8',
      postId: 'squadP1',
      userId: '2',
      content: 'comment #1',
      contentHtml: '<p>comment #1</p>',
      createdAt: new Date(2020, 1, 10, 0, 0),
    },
  ]);

  await deleteKeysByPattern(`${rateLimiterName}:*`);
});

afterAll(() => disposeGraphQLTesting(state));

const saveCommentMentionFixtures = async (sampleAuthor = usersFixture[0]) => {
  const promises = usersFixture.map((user) =>
    con
      .getRepository(User)
      .update({ id: user.id }, { ...user, username: user.name }),
  );
  await Promise.all(promises);
  await con
    .getRepository(Post)
    .update({ id: 'p1' }, { ...postsFixture[0], authorId: sampleAuthor.id });
  await con.getRepository(CommentMention).save(
    usersFixture
      .filter(({ id }) => id !== loggedUser)
      .map(({ id }) => ({
        commentId: 'c1',
        mentionedUserId: id,
        commentByUserId: loggedUser,
      })),
  );
};

const saveSquadFixture = async (sourceId: string) => {
  await con.getRepository(User).save([
    {
      id: 'sample1',
      name: 'sample1',
      username: 'sample1',
      image: 'sample1/image',
    },
    {
      id: 'sample2',
      name: 'sample2',
      username: 'sample2',
      image: 'sample2/image',
    },
  ]);
  await con.getRepository(Source).update({ id: sourceId }, { private: true });
  await con.getRepository(ContentPreferenceSource).save([
    {
      sourceId,
      referenceId: sourceId,
      userId: '1',
      createdAt: new Date(2022, 11, 19),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
    {
      sourceId,
      referenceId: sourceId,
      userId: 'sample1',
      createdAt: new Date(2022, 11, 19),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt2',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
  ]);
};

const commentFields =
  'id, content, contentHtml, createdAt, permalink, upvoted, author { id, name, image }';

describe('query postComments', () => {
  const QUERY = `query PostComments($postId: ID!, $after: String, $first: Int) {
  postComments(postId: $postId, after: $after, first: $first) {
    pageInfo { endCursor, hasNextPage }
    edges { node {
      ${commentFields}
      children {
        pageInfo { endCursor, hasNextPage }
        edges { node { ${commentFields} } }
      }
    } }
  }
  }`;

  beforeEach(async () => {
    await con.getRepository(UserComment).save([
      { commentId: 'c1', userId: '1', vote: UserVote.Up },
      { commentId: 'c7', userId: '1', vote: UserVote.Up },
      { commentId: 'c2', userId: '2', vote: UserVote.Up },
    ]);
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { postId: 'p1' },
      },
      'FORBIDDEN',
    );
  });

  it('should fetch comments and sub-comments of a post', async () => {
    const res = await client.query(QUERY, { variables: { postId: 'p1' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should fetch comments and sub-comments of a post with upvoted', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, { variables: { postId: 'p1' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  it('should filter out comments that are vordr prevented', async () => {
    loggedUser = '1';

    await saveFixtures(con, Comment, [
      {
        id: 'vordr-comment',
        postId: 'p1',
        userId: '2',
        content: 'comment',
        contentHtml: '<p>comment</p>',
        flags: { vordr: true },
      },
    ]);

    const res = await client.query(QUERY, { variables: { postId: 'p1' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.postComments.edges.length).toEqual(3);
  });

  it('should not filter out my own comments that vordr prevented', async () => {
    loggedUser = '2';

    await saveFixtures(con, Comment, [
      {
        id: 'vordr-comment',
        postId: 'p1',
        userId: '2',
        content: 'comment',
        contentHtml: '<p>comment</p>',
        flags: { vordr: true },
      },
    ]);

    const res = await client.query(QUERY, { variables: { postId: 'p1' } });
    expect(res.errors).toBeFalsy();
    expect(res.data.postComments.edges.length).toEqual(4);
  });
});

describe('query userComments', () => {
  const QUERY = `query UserComments($userId: ID!, $after: String, $first: Int) {
    userComments(userId: $userId, after: $after, first: $first) {
      pageInfo { endCursor, hasNextPage }
      edges { node {
        ${commentFields}
      } }
    }
  }`;

  it('should fetch comments by user id', async () => {
    const res = await client.query(QUERY, { variables: { userId: '1' } });
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
  });

  describe('vordr', () => {
    beforeEach(async () => {
      await saveFixtures(con, Comment, [
        {
          id: 'vordr-comment',
          postId: 'p1',
          userId: '2',
          content: 'comment',
          contentHtml: '<p>comment</p>',
          flags: { vordr: true },
        },
      ]);
    });

    it('should filter out comments that are vordr prevented', async () => {
      loggedUser = '1';
      const res = await client.query(QUERY, { variables: { userId: '2' } });
      expect(res.errors).toBeFalsy();
      expect(res.data.userComments.edges.length).toEqual(2);
    });

    it('should not filter out comments that are vordr prevented if user is author', async () => {
      loggedUser = '2';
      const res = await client.query(QUERY, { variables: { userId: '2' } });
      expect(res.errors).toBeFalsy();
      expect(res.data.userComments.edges.length).toEqual(3);
    });
  });
});

describe('query commentFeed', () => {
  const QUERY = `query CommentFeed($after: String, $first: Int) {
    commentFeed(after: $after, first: $first) {
      pageInfo { endCursor, hasNextPage }
      edges { node {
        ${commentFields}
      } }
    }
  }`;

  beforeEach(async () => {
    await Promise.all(
      usersFixture.map((user) =>
        con.getRepository(User).update(
          { id: user.id },
          {
            ...user,
            reputation: 100,
          },
        ),
      ),
    );
  });

  it('should fetch comments feed', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, { variables: { first: 20 } });
    expect(res.errors).toBeFalsy();
    expect(res.data.commentFeed.edges.length).toEqual(7);
  });

  describe('vordr', () => {
    beforeEach(async () => {
      await saveFixtures(con, Comment, [
        {
          id: 'vordr-comment',
          postId: 'p1',
          userId: '2',
          content: 'comment',
          contentHtml: '<p>comment</p>',
          flags: { vordr: true },
        },
      ]);
    });

    it('should filter out comments that are vordr prevented', async () => {
      loggedUser = '1';
      const res = await client.query(QUERY, { variables: { first: 20 } });
      expect(res.errors).toBeFalsy();
      expect(res.data.commentFeed.edges.length).toEqual(7);
    });

    it('should not filter out comments that are vordr prevented if user is author', async () => {
      loggedUser = '2';
      const res = await client.query(QUERY, { variables: { first: 20 } });
      expect(res.errors).toBeFalsy();
      expect(res.data.commentFeed.edges.length).toEqual(8);
    });
  });
});

describe('query commentUpvotes', () => {
  const QUERY = `
  query commentUpvotes($id: String!) {
    commentUpvotes(id: $id) {
      edges {
        node {
          votedAt
          user {
            name
            username
            bio
            image
          }
        }
      }
    }
  }
  `;

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testQueryErrorCode(
      client,
      {
        query: QUERY,
        variables: { id: 'c1' },
      },
      'FORBIDDEN',
    );
  });

  it('should return users that upvoted the comment by id in descending order', async () => {
    const commentUpvoteRepo = con.getRepository(UserComment);
    const votedAtOld = new Date('2020-09-22T07:15:51.247Z');
    const votedAtNew = new Date('2021-09-22T07:15:51.247Z');
    await commentUpvoteRepo.save({
      userId: '1',
      commentId: 'c1',
      vote: UserVote.Up,
    });
    await commentUpvoteRepo.save({
      userId: '1',
      commentId: 'c1',
      votedAt: votedAtOld,
      vote: UserVote.Up,
    });
    await commentUpvoteRepo.save({
      userId: '2',
      commentId: 'c1',
      vote: UserVote.Up,
    });
    await commentUpvoteRepo.save({
      userId: '2',
      commentId: 'c1',
      votedAt: votedAtNew,
      vote: UserVote.Up,
    });

    const res = await client.query(QUERY, { variables: { id: 'c1' } });

    const [secondUpvote, firstUpvote] = res.data.commentUpvotes.edges;
    expect(res.errors).toBeFalsy();
    expect(res.data).toMatchSnapshot();
    expect(new Date(secondUpvote.node.votedAt).getTime()).toBeGreaterThan(
      new Date(firstUpvote.node.votedAt).getTime(),
    );
  });
});

describe('query commentPreview', () => {
  const QUERY = `
    query CommentPreview($content: String!, $sourceId: String) {
      commentPreview(content: $content, sourceId: $sourceId)
    }
  `;

  it('should not authorize when not logged in', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { content: '# Test' } },
      'UNAUTHENTICATED',
    ));

  it('should return markdown equivalent of the content', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();
    const content = '# Test';
    const res = await client.query(QUERY, { variables: { content } });
    expect(res.errors).toBeFalsy();
    expect(res.data.commentPreview).toMatchSnapshot();

    const mention = '@Lee';
    const withMention = await client.query(QUERY, {
      variables: { content: mention },
    });
    expect(withMention.errors).toBeFalsy();
    expect(withMention.data.commentPreview).toMatchSnapshot();
  });

  it('should return markdown equivalent of the content with hyphen mention', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();

    await con
      .getRepository(User)
      .update({ username: 'Lee' }, { username: 'Lee-Hansel' });
    const mention = '@Lee-Hansel';
    const withMention = await client.query(QUERY, {
      variables: { content: mention },
    });
    expect(withMention.errors).toBeFalsy();
    expect(withMention.data.commentPreview).toMatchSnapshot();
  });

  it('should return markdown with user mentioned inside squad', async () => {
    loggedUser = '1';
    const sourceId = 'a';
    await saveSquadFixture(sourceId);
    await saveCommentMentionFixtures();

    const mention = '@sample1 @sample2';
    const withMention = await client.query(QUERY, {
      variables: { content: mention, sourceId },
    });
    expect(withMention.errors).toBeFalsy();
    expect(withMention.data.commentPreview).toMatchSnapshot();
  });

  it('should return markdown equivalent of the content with special characters on mention', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();
    const content = '# Test';
    const res = await client.query(QUERY, { variables: { content } });
    expect(res.errors).toBeFalsy();
    expect(res.data.commentPreview).toMatchSnapshot();

    const mention0 = await client.query(QUERY, {
      variables: { content: '@Lee' },
    });
    expect(mention0.errors).toBeFalsy();
    expect(mention0.data.commentPreview).toMatchSnapshot();

    const mention1 = await client.query(QUERY, {
      variables: { content: '@Lee.' },
    });
    expect(mention1.errors).toBeFalsy();
    expect(mention1.data.commentPreview).toMatchSnapshot();

    const mention2 = await client.query(QUERY, {
      variables: { content: '@Lee/@Hansel' },
    });
    expect(mention2.errors).toBeFalsy();
    expect(mention2.data.commentPreview).toMatchSnapshot();

    const mention3 = await client.query(QUERY, {
      variables: { content: '@Lee,@Hansel,@Solevilla' },
    });
    expect(mention3.errors).toBeFalsy();
    expect(mention3.data.commentPreview).toMatchSnapshot();

    const mention4 = await client.query(QUERY, {
      variables: { content: '@Lee@Hansel@Solevilla' },
    });
    expect(mention4.errors).toBeFalsy();
    expect(mention4.data.commentPreview).toMatchSnapshot(); // expect to display no mention

    const mention5 = await client.query(QUERY, {
      variables: { content: 'Hi@Solevilla' },
    });
    expect(mention5.errors).toBeFalsy();
    expect(mention5.data.commentPreview).toMatchSnapshot(); // expect to display no mention

    const mention6 = await client.query(QUERY, {
      variables: { content: 'Hi!@Solevilla' },
    });
    expect(mention6.errors).toBeFalsy();
    expect(mention6.data.commentPreview).toMatchSnapshot();

    const mention7 = await client.query(QUERY, {
      variables: { content: 'Hi @Solevilla' },
    });
    expect(mention7.errors).toBeFalsy();
    expect(mention7.data.commentPreview).toMatchSnapshot();

    const mention8 = await client.query(QUERY, {
      variables: { content: 'Hi @Solevilla!' },
    });
    expect(mention8.errors).toBeFalsy();
    expect(mention8.data.commentPreview).toMatchSnapshot();

    const mention9 = await client.query(QUERY, {
      variables: {
        content:
          "Hi @Solevilla! This is normal comment, let's tag @Lee as well",
      },
    });
    expect(mention9.errors).toBeFalsy();
    expect(mention9.data.commentPreview).toMatchSnapshot();
  });

  it('should only render markdown not HTML', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();
    const content = '# Test <button>Test</button>';
    const res = await client.query(QUERY, { variables: { content } });
    expect(res.errors).toBeFalsy();
    expect(res.data.commentPreview).toMatchSnapshot();
  });
});

describe('query recommendedMentions', () => {
  const QUERY = `
    query RecommendedMentions($postId: String, $query: String, $limit: Int, $sourceId: String) {
      recommendedMentions(postId: $postId, query: $query, limit: $limit, sourceId: $sourceId) {
        id
        name
        username
        image
      }
    }
  `;

  it('should not authorize when not logged in', () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { postId: 'p1' } },
      'UNAUTHENTICATED',
    ));

  it('should return author and previously mentioned users if query is empty', async () => {
    loggedUser = '1';
    const author = usersFixture[4];
    await saveCommentMentionFixtures(author);

    const res = await client.query(QUERY, { variables: { postId: 'p1' } });
    expect(res.errors).toBeFalsy();
    const ids = res.data.recommendedMentions.map(({ id }) => id);
    expect(ids).toIncludeSameMembers(Array.from(new Set(ids))); // to easily see there's no duplicates
    expect(res.data.recommendedMentions.length).toEqual(5);
    expect(res.data.recommendedMentions[0].name).toEqual(author.name);
  });

  it('should still work without post id and return previously mentioned users if query is empty', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();

    const res = await client.query(QUERY, { variables: {} });
    expect(res.errors).toBeFalsy();
    expect(res.data.recommendedMentions.length).toEqual(5);
  });

  it('should return users with user or username starting with the query prioritizing previously mentioned ones', async () => {
    loggedUser = '1';
    await con.getRepository(User).save({
      id: 'sample',
      name: 'sample',
      username: 'sample',
      image: 'sample/image',
    });
    await saveCommentMentionFixtures();

    const res = await client.query(QUERY, {
      variables: { postId: 'p1', query: 's' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.recommendedMentions).toMatchSnapshot(); // to easily see there's no duplicates
    expect(res.data.recommendedMentions.length).toEqual(3);
    expect(res.data.recommendedMentions[0]).not.toEqual('sample');
  });

  it('should return users but must be filtered to which source feed the commenter is at', async () => {
    loggedUser = '1';
    const sourceId = 'a';
    await saveSquadFixture(sourceId);
    await saveCommentMentionFixtures();

    const res = await client.query(QUERY, {
      variables: { postId: 'p1', query: 's', sourceId },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.recommendedMentions.length).toEqual(1);
    expect(res.data.recommendedMentions[0]).not.toEqual('sample2');
  });
});

describe('function updateMentions', () => {
  it('should update mentions based on passed comment ids utilizing old and new username', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();
    const comment = con
      .getRepository(Comment)
      .create({ id: 'cm', postId: 'p1', userId: '1', content: '@Solevilla' });
    const saved = await saveComment(con, comment);
    expect(saved).toMatchSnapshot({ createdAt: expect.any(Date) });
    const user = await con.getRepository(User).findOneBy({ id: '7' });
    const previous = user.username;
    delete user.permalink;
    user.username = 'sshanzel';
    const updated = await con.transaction(async (transaction) => {
      await transaction.getRepository(User).update({ id: user.id }, user);
      await updateMentions(transaction, previous, user.username, ['cm']);
      return transaction.getRepository(Comment).findOneBy({ id: 'cm' });
    });
    expect(updated).toMatchSnapshot({ createdAt: expect.any(Date) });
  });
});

describe('mutation commentOnPost', () => {
  const MUTATION = `
  mutation CommentOnPost($postId: ID!, $content: String!) {
  commentOnPost(postId: $postId, content: $content) {
    id, content
  }
}`;

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: 'comment' },
      },
      'FORBIDDEN',
    );
  });

  it('should not allow comment if content is empty string', () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: '   ' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: '# my comment http://daily.dev' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find post', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          postId: 'invalid',
          content: '# my comment http://daily.dev',
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when cannot find user', () => {
    loggedUser = '10';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: '# my comment http://daily.dev' },
      },
      'NOT_FOUND',
    );
  });

  it('should comment markdown on a post', async () => {
    loggedUser = '1';
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(5);
    const res = await client.mutate(MUTATION, {
      variables: { postId: 'p1', content: '# my comment http://daily.dev' },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Comment).find({
      select: ['id', 'content', 'contentHtml', 'parentId'],
      order: { createdAt: 'DESC' },
      where: { postId: 'p1' },
    });
    expect(actual.length).toEqual(6);
    expect(actual[0]).toMatchSnapshot({
      id: expect.any(String),
      contentHtml: `<h1>my comment <a href=\"http://daily.dev\" target=\"_blank\" rel=\"noopener nofollow\">http://daily.dev</a></h1>\n`,
    });
    expect(res.data.commentOnPost.id).toEqual(actual[0].id);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.comments).toEqual(6);
  });

  it('should comment markdown on a post with user mention', async () => {
    loggedUser = '1';
    await saveCommentMentionFixtures();
    const params = {
      commentByUserId: '1',
      mentionedUserId: '4',
    };
    const before = await con.getRepository(CommentMention).findBy(params);
    expect(before.length).toEqual(1);
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(0);
    const res = await client.mutate(MUTATION, {
      variables: { postId: 'p1', content: '@Lee' },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Comment).find({
      select: ['id', 'content', 'contentHtml', 'parentId'],
      order: { createdAt: 'DESC' },
      where: { postId: 'p1' },
    });
    expect(actual.length).toEqual(6);
    expect(actual[0]).toMatchSnapshot({
      id: expect.any(String),
      contentHtml: `<p>${getMentionLink({ id: '4', username: 'Lee' })}</p>\n`,
    });
    expect(res.data.commentOnPost.id).toEqual(actual[0].id);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    const after = await con.getRepository(CommentMention).findBy(params);
    expect(after.length).toEqual(2);
    expect(post.comments).toEqual(1);
  });

  it('should comment markdown on a post with user mention inside the squad only', async () => {
    loggedUser = '1';
    const sourceId = 'a';
    await saveSquadFixture('a');
    await saveCommentMentionFixtures();
    await con
      .getRepository(Source)
      .update({ id: sourceId }, { type: SourceType.Squad });
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(0);
    const res = await client.mutate(MUTATION, {
      variables: { postId: 'p1', content: '@sample1 @sample2' },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Comment).find({
      select: ['id', 'content', 'contentHtml', 'parentId'],
      order: { createdAt: 'DESC' },
      where: { postId: 'p1' },
    });
    expect(actual.length).toEqual(6);
    const mention = getMentionLink({
      id: 'sample1',
      username: 'sample1',
    });
    expect(actual[0]).toMatchSnapshot({
      id: expect.any(String),
      contentHtml: `<p>${mention} @sample2</p>\n`,
    });
    expect(res.data.commentOnPost.id).toEqual(actual[0].id);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.comments).toEqual(1);
  });

  it('should comment markdown but restrict mentioning ownself', async () => {
    loggedUser = '1';
    const mention = '@Ido';
    await saveCommentMentionFixtures();
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(0);
    const res = await client.mutate(MUTATION, {
      variables: { postId: 'p1', content: mention },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Comment).find({
      select: ['id', 'content', 'contentHtml', 'parentId'],
      order: { createdAt: 'DESC' },
      where: { postId: 'p1' },
    });
    expect(actual.length).toEqual(6);
    expect(actual[0]).toMatchSnapshot({
      id: expect.any(String),
      contentHtml: `<p>${mention}</p>\n`,
    });
    expect(res.data.commentOnPost.id).toEqual(actual[0].id);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.comments).toEqual(1);
  });

  it('should disallow comment on post from public source for blocked members', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: false });
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { private: false, sourceId: 'a' });
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
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: 'comment' },
      },
      'FORBIDDEN',
    );
  });

  describe('rate limiting', () => {
    const redisKey = `${rateLimiterName}:1:createComment`;
    const variables = { postId: 'p1', content: 'comment' };
    it('store rate limiting state in redis', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables,
      });

      expect(res.errors).toBeFalsy();
      expect(await getRedisObject(redisKey)).toEqual('1');
    });

    it('should rate limit creating posts to 10 per hour', async () => {
      loggedUser = '1';

      for (let i = 0; i < 20; i++) {
        const res = await client.mutate(MUTATION, {
          variables,
        });

        expect(res.errors).toBeFalsy();
      }
      expect(await getRedisObject(redisKey)).toEqual('20');

      await testMutationErrorCode(
        client,
        { mutation: MUTATION, variables },
        'RATE_LIMITED',
        'Take a break. You already commented enough in the last hour',
      );

      // Check expiry, to not cause it to be flaky, we check if it is within 10 seconds
      expect(await getRedisObjectExpiry(redisKey)).toBeLessThanOrEqual(3600);
      expect(await getRedisObjectExpiry(redisKey)).toBeGreaterThanOrEqual(3590);
    });
  });

  describe('vordr', () => {
    it('should set correct vordr flags on good user', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { postId: 'p1', content: 'comment' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.commentOnPost.id,
      });

      expect(comment.flags).toEqual({ vordr: false });
    });

    it('should set correct vordr flags on comment by good user if vordr filter catches it', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { postId: 'p1', content: 'VordrWillCatchYou' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.commentOnPost.id,
      });

      expect(comment.flags).toEqual({ vordr: true });
    });

    it('should set correct vordr flags on comment by bad user', async () => {
      loggedUser = 'vordr';

      const res = await client.mutate(MUTATION, {
        variables: { postId: 'p1', content: 'comment' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.commentOnPost.id,
      });

      expect(comment.flags).toEqual({ vordr: true });
    });
  });
});

describe('mutation commentOnComment', () => {
  const MUTATION = `
  mutation CommentOnComment($commentId: ID!, $content: String!) {
  commentOnComment(commentId: $commentId, content: $content) {
    id, content
  }
}`;

  it('should not allow comment if content is empty string', () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: '   ' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          commentId: 'c1',
          content: '# my comment http://daily.dev',
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find parent comment', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          commentId: 'invalid',
          content: '# my comment http://daily.dev',
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when cannot find user', () => {
    loggedUser = '10';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          commentId: 'c1',
          content: '# my comment http://daily.dev',
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when commenting on a sub-comment', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          commentId: 'c2',
          content: '# my comment http://daily.dev',
        },
      },
      'FORBIDDEN',
    );
  });

  it('should throw error when user cannot access the post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          content: '# my comment http://daily.dev',
          commentId: 'c1',
        },
      },
      'FORBIDDEN',
    );
  });

  it('should comment on a comment', async () => {
    loggedUser = '1';
    const before = await con
      .getRepository(Comment)
      .findOneByOrFail({ id: 'c1' });
    expect(before.comments).toEqual(1);
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(5);
    const res = await client.mutate(MUTATION, {
      variables: { content: '# my comment http://daily.dev', commentId: 'c1' },
    });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Comment).find({
      select: ['id', 'content', 'parentId', 'postId', 'comments'],
      order: { createdAt: 'DESC' },
      where: { postId: 'p1' },
    });
    expect(actual.length).toEqual(6);
    expect(actual[0]).toMatchSnapshot({ id: expect.any(String) });
    expect(res.data.commentOnComment.id).toEqual(actual[0].id);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.comments).toEqual(6);
    expect(actual.find((c) => c.id === 'c1')!.comments).toEqual(2);
    expect(post.statsUpdatedAt.getTime()).toBeGreaterThan(
      beforePost.statsUpdatedAt.getTime(),
    );
  });

  it('should disallow comment on comment from post on public source for blocked members', async () => {
    loggedUser = '1';
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { type: SourceType.Squad, private: false });
    await con
      .getRepository(Post)
      .update({ id: 'p1' }, { private: false, sourceId: 'a' });
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

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          content: '# my comment http://daily.dev',
          commentId: 'c1',
        },
      },
      'FORBIDDEN',
    );
  });

  describe('rate limiting', () => {
    const redisKey = `${rateLimiterName}:1:createComment`;
    const variables = {
      commentId: 'c1',
      content: '# my comment http://daily.dev',
    };
    it('store rate limiting state in redis', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables,
      });

      expect(res.errors).toBeFalsy();
      expect(await getRedisObject(redisKey)).toEqual('1');
    });

    it('should rate limit creating posts to 10 per hour', async () => {
      loggedUser = '1';

      for (let i = 0; i < 20; i++) {
        const res = await client.mutate(MUTATION, {
          variables,
        });

        expect(res.errors).toBeFalsy();
      }
      expect(await getRedisObject(redisKey)).toEqual('20');

      await testMutationErrorCode(
        client,
        { mutation: MUTATION, variables },
        'RATE_LIMITED',
        'Take a break. You already commented enough in the last hour',
      );

      // Check expiry, to not cause it to be flaky, we check if it is within 10 seconds
      expect(await getRedisObjectExpiry(redisKey)).toBeLessThanOrEqual(3600);
      expect(await getRedisObjectExpiry(redisKey)).toBeGreaterThanOrEqual(3590);
    });
  });

  describe('vordr', () => {
    it('should set correct vordr flags on comment reply by good user', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { commentId: 'c1', content: 'comment' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.commentOnComment.id,
      });

      expect(comment.flags).toEqual({ vordr: false });
    });

    it('should set correct vordr flags on comment reply by good user if vordr filter catches it', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { commentId: 'c1', content: 'VordrWillCatchYou' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.commentOnComment.id,
      });

      expect(comment.flags).toEqual({ vordr: true });
    });

    it('should set correct vordr flags on comment reply by bad user', async () => {
      loggedUser = 'vordr';

      const res = await client.mutate(MUTATION, {
        variables: { commentId: 'c1', content: 'comment' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.commentOnComment.id,
      });

      expect(comment.flags).toEqual({ vordr: true });
    });
  });
});

describe('mutation deleteComment', () => {
  const MUTATION = `
  mutation DeleteComment($id: ID!) {
  deleteComment(id: $id) {
    _
  }
}`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'c1' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find comment', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'invalid' },
      },
      'NOT_FOUND',
    );
  });

  it('should forbidden when user is not the author', () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'c1' },
      },
      'FORBIDDEN',
    );
  });

  it('should delete a comment', async () => {
    loggedUser = '1';
    const before = await con
      .getRepository(Comment)
      .findOneByOrFail({ id: 'c1' });
    expect(before.comments).toEqual(1);
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(5);
    const res = await client.mutate(MUTATION, { variables: { id: 'c2' } });
    expect(res.errors).toBeFalsy();
    const actual = await con
      .getRepository(Comment)
      .find({ select: ['id', 'comments'], where: { postId: 'p1' } });
    expect(actual.length).toEqual(4);
    expect(actual.find((c) => c.id === 'c1')!.comments).toEqual(0);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.comments).toEqual(4);
    expect(post.statsUpdatedAt.getTime()).toBeGreaterThan(
      beforePost.statsUpdatedAt.getTime(),
    );
  });

  it('should delete a comment and its children', async () => {
    loggedUser = '1';
    const before = await con.getRepository(Comment).findBy({ postId: 'p1' });
    expect(before.length).toEqual(5);
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(5);
    const res = await client.mutate(MUTATION, { variables: { id: 'c1' } });
    expect(res.errors).toBeFalsy();
    const actual = await con.getRepository(Comment).findBy({ postId: 'p1' });
    expect(actual.length).toEqual(3);
    const post = await con.getRepository(Post).findOneByOrFail({ id: 'p1' });
    expect(post.comments).toEqual(3);
  });

  it("should forbidden when other user doesn't have the right permissions", async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).insert({
      sourceId: 'squad',
      referenceId: 'squad',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 's1',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'c8' },
      },
      'FORBIDDEN',
    );
  });

  it('should delete a comment if source admin has permissions', async () => {
    loggedUser = '1';
    await con.getRepository(ContentPreferenceSource).insert({
      sourceId: 'squad',
      referenceId: 'squad',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 's1',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    });
    const before = await con.getRepository(Comment).findBy({ postId: 'p1' });
    expect(before.length).toEqual(5);
    const beforePost = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'p1' });
    expect(beforePost.comments).toEqual(5);
    const res = await client.mutate(MUTATION, { variables: { id: 'c8' } });
    expect(res.errors).toBeFalsy();
    const actual = await con
      .getRepository(Comment)
      .find({ select: ['id', 'comments'], where: { postId: 'squadP1' } });
    expect(actual.length).toEqual(0);
    const post = await con
      .getRepository(Post)
      .findOneByOrFail({ id: 'squadP1' });
    expect(post.comments).toEqual(0);
  });
});

describe('permalink field', () => {
  const MUTATION = `
  mutation CommentOnPost($postId: ID!, $content: String!) {
  commentOnPost(postId: $postId, content: $content) {
    id, permalink
  }
}`;

  it('should return permalink', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { postId: 'p1', content: '# my comment http://daily.dev' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.commentOnPost.permalink).toEqual(
      `http://localhost:5002/posts/p1#c-${res.data.commentOnPost.id}`,
    );
  });
});

describe('mutation editComment', () => {
  const MUTATION = `
  mutation EditComment($id: ID!, $content: String!) {
  editComment(id: $id, content: $content) {
    id, content, lastUpdatedAt
  }
}`;

  it('should not allow comment if content is empty string', () => {
    loggedUser = '1';

    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { postId: 'p1', content: '   ' },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'c1', content: 'Edit' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find comment', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'invalid', content: 'Edit' },
      },
      'NOT_FOUND',
    );
  });

  it('should forbidden when user is not the author', () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'c1', content: 'Edit' },
      },
      'FORBIDDEN',
    );
  });

  it('should edit a comment', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { id: 'c2', content: 'Edit' },
    });
    expect(res.errors).toBeFalsy();
    expect(res.data.editComment).toEqual({
      id: 'c2',
      lastUpdatedAt: expect.any(String),
      content: 'Edit',
    });
  });

  describe('vordr', () => {
    it('should set correct vordr flags on edited comment by good user', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { id: 'c2', content: 'comment' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.editComment.id,
      });

      expect(comment.flags).toEqual({ vordr: false });
    });

    it('should set correct vordr flags on edited comment by good user if vordr filter catches it', async () => {
      loggedUser = '1';

      const res = await client.mutate(MUTATION, {
        variables: { id: 'c2', content: 'VordrWillCatchYou' },
      });

      expect(res.errors).toBeFalsy();

      const comment = await con.getRepository(Comment).findOneByOrFail({
        id: res.data.editComment.id,
      });

      expect(comment.flags).toEqual({ vordr: true });
    });
  });
});

describe('mutation reportComment', () => {
  const MUTATION = `
    mutation ReportComment($commentId: ID!, $reason: ReportCommentReason, $note: String) {
      reportComment(commentId: $commentId, reason: $reason, note: $note) {
        _
      }
    }
  `;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { commentId: 'c1', reason: 'HATEFUL', note: 'Test comment' },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find comment', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          commentId: 'invalid',
          reason: 'HATEFUL',
          note: 'Test comment',
        },
      },
      'NOT_FOUND',
    );
  });

  it('should report comment with note', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: {
        commentId: 'c1',
        reason: 'HATEFUL',
        note: 'Test comment',
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con
      .getRepository(CommentReport)
      .findOneBy({ commentId: 'c1' });
    expect(comment).toEqual({
      commentId: 'c1',
      userId: '1',
      createdAt: expect.anything(),
      reason: 'HATEFUL',
      note: 'Test comment',
    });
  });

  it('should report comment without note', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { commentId: 'c1', reason: 'HATEFUL' },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con
      .getRepository(CommentReport)
      .findOneBy({ commentId: 'c1' });
    expect(comment).toEqual({
      commentId: 'c1',
      userId: '1',
      createdAt: expect.anything(),
      reason: 'HATEFUL',
      note: null,
    });
  });

  it('should ignore conflicts', async () => {
    loggedUser = '1';
    const res1 = await client.mutate(MUTATION, {
      variables: { commentId: 'c1', reason: 'HATEFUL' },
    });
    expect(res1.errors).toBeFalsy();
    const comment = await con
      .getRepository(CommentReport)
      .findOneBy({ commentId: 'c1' });
    expect(comment).toEqual({
      commentId: 'c1',
      userId: '1',
      createdAt: expect.anything(),
      reason: 'HATEFUL',
      note: null,
    });
    const res2 = await client.mutate(MUTATION, {
      variables: { commentId: 'c1', reason: 'HATEFUL' },
    });
    expect(res2.errors).toBeFalsy();
  });
});

describe('query comment', () => {
  const QUERY = `
    query Comment($id: ID!) {
      comment(id: $id) {
        id
        content
      }
    }
  `;

  it('should not return comment by id when not authenticated', async () =>
    testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: '123' } },
      'UNAUTHENTICATED',
    ));

  it('should return comment by id even if user is not the author', async () => {
    loggedUser = '2';

    const comment = await client.query(QUERY, { variables: { id: 'c1' } });
    expect(comment.errors).toBeFalsy();
    expect(comment.data.comment.id).toEqual('c1');
  });

  it('should return error when not part of private squad', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).update({ id: 'c1' }, { userId: '1' });
    await con
      .getRepository(Source)
      .update({ id: 'a' }, { private: true, type: SourceType.Squad });

    return testQueryErrorCode(
      client,
      { query: QUERY, variables: { id: 'c1' } },
      'FORBIDDEN',
    );
  });

  it('should return comment by id', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).update({ id: 'c1' }, { userId: '1' });
    const comment = await client.query(QUERY, { variables: { id: 'c1' } });
    expect(comment.errors).toBeFalsy();
    expect(comment.data.comment.id).toEqual('c1');
  });
});

describe('userState field', () => {
  const QUERY = `query PostComments($postId: ID!, $after: String, $first: Int, $sortBy: SortCommentsBy) {
    postComments(postId: $postId, after: $after, first: $first, sortBy: $sortBy) {
      pageInfo { endCursor, hasNextPage }
      edges { node {
        id
        userState {
          vote
        }
      } }
    }
    }`;

  it('should return null if anonymous user', async () => {
    const res = await client.query(QUERY, {
      variables: { postId: 'p1' },
    });

    expect(res.errors).toBeFalsy();
    res.data.postComments.edges.forEach((edge) => {
      expect(edge.node.userState).toBeNull();
    });
  });

  it('should return default state if state does not exist', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { postId: 'p1' },
    });
    expect(res.errors).toBeFalsy();
    const { vote } = con.getRepository(UserComment).create();

    expect(res.errors).toBeFalsy();
    res.data.postComments.edges.forEach((edge) => {
      expect(edge.node.userState).toMatchObject({
        vote,
      });
    });
  });

  it('should sort comment oldest first', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { postId: 'p1' },
    });
    expect(res.errors).toBeFalsy();

    const map = res.data.postComments.edges.map((edge) => edge.node.id);
    expect(map).toEqual(['c1', 'c3', 'c6']);
  });

  it('should sort comment newest first', async () => {
    loggedUser = '1';
    const res = await client.query(QUERY, {
      variables: { postId: 'p1', sortBy: SortCommentsBy.NewestFirst },
    });
    expect(res.errors).toBeFalsy();

    const map = res.data.postComments.edges.map((edge) => edge.node.id);
    expect(map).toEqual(['c6', 'c3', 'c1']);
  });

  it('should return user state', async () => {
    loggedUser = '1';
    const userComment = await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    expect(userComment).toBeTruthy();

    const res = await client.query(QUERY, {
      variables: { postId: 'p1' },
    });

    expect(res.errors).toBeFalsy();
    res.data.postComments.edges.forEach((edge) => {
      if (edge.node.id === 'c1') {
        expect(edge.node.userState).toMatchObject({
          vote: UserVote.Up,
        });
      } else {
        expect(edge.node.userState).toMatchObject({
          vote: UserVote.None,
        });
      }
    });
  });
});

describe('mutation vote comment', () => {
  const MUTATION = `
    mutation Vote($id: ID!, $vote: Int!, $entity: UserVoteEntity!) {
      vote(id: $id, vote: $vote, entity: $entity) {
        _
      }
    }`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          id: 'c1',
          vote: UserVote.Up,
          entity: UserVoteEntity.Comment,
        },
      },
      'UNAUTHENTICATED',
    ));

  it('should throw not found when cannot find comment', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          id: 'invalid',
          vote: UserVote.Up,
          entity: UserVoteEntity.Comment,
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw not found when cannot find user', () => {
    loggedUser = '15';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          id: 'c1',
          vote: UserVote.Up,
          entity: UserVoteEntity.Comment,
        },
      },
      'NOT_FOUND',
    );
  });

  it('should throw error when user cannot access the commented post', async () => {
    loggedUser = '1';
    await con.getRepository(Source).update({ id: 'a' }, { private: true });
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: {
          id: 'c1',
          vote: UserVote.Up,
          entity: UserVoteEntity.Comment,
        },
      },
      'FORBIDDEN',
    );
  });

  it('should throw when invalid vote option', () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { id: 'c1', vote: 3, entity: UserVoteEntity.Comment },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should upvote', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Up,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const userComment = await con.getRepository(UserComment).findOneBy({
      userId: loggedUser,
      commentId: 'c1',
    });
    expect(userComment).toMatchObject({
      userId: loggedUser,
      commentId: 'c1',
      vote: UserVote.Up,
    });
    const commment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(commment?.upvotes).toEqual(4);
    const commentUpvote = await con.getRepository(UserComment).findOneBy({
      userId: loggedUser,
      commentId: 'c1',
      vote: UserVote.Up,
    });
    expect(commentUpvote).toMatchObject({
      userId: loggedUser,
      commentId: 'c1',
    });
  });

  it('should downvote', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).save({
      id: 'c1',
      downvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Down,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const userComment = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(userComment).toMatchObject({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    const post = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(post?.downvotes).toEqual(4);
  });

  it('should cancel vote', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 3,
    });
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.None,
        entity: UserVoteEntity.Comment,
      },
    });
    const userComment = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userComment).toMatchObject({
      userId: loggedUser,
      commentId: 'c1',
      vote: UserVote.None,
    });
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(3);
  });

  it('should not set votedAt when vote is not set on insert', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      hidden: false,
    });
    const userCommentBefore = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(userCommentBefore?.votedAt).toBeNull();
  });

  it('should set votedAt when user votes for the first time', async () => {
    loggedUser = '1';
    const userCommentBefore = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(userCommentBefore).toBeNull();
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Down,
        entity: UserVoteEntity.Comment,
      },
    });
    const userComment = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userComment?.votedAt).not.toBeNull();
  });

  it('should update votedAt when vote value changes', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
      hidden: false,
    });
    const userCommentBefore = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Down,
        entity: UserVoteEntity.Comment,
      },
    });
    const userComment = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userCommentBefore?.votedAt?.toISOString()).not.toBe(
      userComment?.votedAt?.toISOString(),
    );
  });

  it('should not update votedAt when vote value stays the same', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
      hidden: false,
    });
    const userCommentBefore = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Up,
        entity: UserVoteEntity.Comment,
      },
    });
    const userComment = await con.getRepository(UserComment).findOneBy({
      commentId: 'c1',
      userId: loggedUser,
    });
    expect(res.errors).toBeFalsy();
    expect(userCommentBefore?.votedAt?.toISOString()).toBe(
      userComment?.votedAt?.toISOString(),
    );
  });

  it('should increment comment upvotes when user upvotes', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 3,
    });
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.None,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Up,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(4);
    expect(comment?.downvotes).toEqual(0);
  });

  it('should increment comment downvotes when user downvotes', async () => {
    loggedUser = '1';
    await con.getRepository(Comment).save({
      id: 'c1',
      downvotes: 3,
    });
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.None,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Down,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(0);
    expect(comment?.downvotes).toEqual(4);
  });

  it('should decrement comment upvotes when user cancels upvote', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.None,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(2);
    expect(comment?.downvotes).toEqual(0);
  });

  it('should decrement comment downvotes when user cancels downvote', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    await con.getRepository(Comment).save({
      id: 'c1',
      downvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.None,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(0);
    expect(comment?.downvotes).toEqual(2);
  });

  it('should decrement comment upvotes and increment downvotes when user changes vote from up to down', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 3,
      downvotes: 2,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Down,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(2);
    expect(comment?.downvotes).toEqual(3);
  });

  it('should increment comment upvotes and decrement downvotes when user changes vote from down to up', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 2,
      downvotes: 3,
    });
    const res = await client.mutate(MUTATION, {
      variables: {
        id: 'c1',
        vote: UserVote.Up,
        entity: UserVoteEntity.Comment,
      },
    });
    expect(res.errors).toBeFalsy();
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(3);
    expect(comment?.downvotes).toEqual(2);
  });

  it('should decrement comment upvotes when UserComment entity is removed', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Up,
    });
    await con.getRepository(Comment).save({
      id: 'c1',
      upvotes: 3,
    });
    await con.getRepository(UserComment).delete({
      commentId: 'c1',
      userId: loggedUser,
    });
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(2);
    expect(comment?.downvotes).toEqual(0);
  });

  it('should decrement comment downvotes when UserComment entity is removed', async () => {
    loggedUser = '1';
    await con.getRepository(UserComment).save({
      commentId: 'c1',
      userId: loggedUser,
      vote: UserVote.Down,
    });
    await con.getRepository(Comment).save({
      id: 'c1',
      downvotes: 3,
    });
    await con.getRepository(UserComment).delete({
      commentId: 'c1',
      userId: loggedUser,
    });
    const comment = await con.getRepository(Comment).findOneBy({ id: 'c1' });
    expect(comment?.upvotes).toEqual(0);
    expect(comment?.downvotes).toEqual(2);
  });
});
