import {
  disposeGraphQLTesting,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  Mutation,
  saveFixtures,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import { Roles, SourceMemberRoles } from '../src/roles';
import {
  Feed,
  Source,
  SquadPublicRequest,
  SquadPublicRequestStatus,
  User,
} from '../src/entity';
import { sourcesFixture } from './fixture/source';
import { usersFixture } from './fixture/user';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import { ContentPreferenceStatus } from '../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';

let con: DataSource;
let state: GraphQLTestingState;
let client: GraphQLTestClient;
let loggedUser: string | null = null;
let roles: Roles[] = [];
const sourceId = 'squad';

jest.mock('../src/common', () => ({
  ...(jest.requireActual('../src/common') as Record<string, unknown>),
  uploadLogo: jest.fn(),
}));

const testModeratorAuthorization = (mutation: Mutation): Promise<void> => {
  roles = [];
  return testMutationErrorCode(client, mutation, 'FORBIDDEN');
};

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(
    () => new MockContext(con, loggedUser, false, roles),
  );
  client = state.client;
});

beforeEach(async () => {
  loggedUser = null;
  roles = [];
  await saveFixtures(con, Source, [sourcesFixture[5]]);
  await saveFixtures(con, User, usersFixture);
  await saveFixtures(
    con,
    Feed,
    usersFixture.map((u) => ({ id: u.id, userId: u.id })),
  );
  await con.getRepository(ContentPreferenceSource).save([
    {
      sourceId,
      referenceId: sourceId,
      userId: '1',
      createdAt: new Date(2022, 11, 19),
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'rt1',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
    {
      sourceId,
      referenceId: sourceId,
      userId: '2',
      createdAt: new Date(2022, 11, 20),
      flags: {
        role: SourceMemberRoles.Moderator,
        referralToken: 'rt2',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '2',
    },
    {
      sourceId,
      referenceId: sourceId,
      userId: '3',
      createdAt: new Date(2022, 11, 19),
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: 'rt3',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '3',
    },
  ]);

  con.getRepository(SquadPublicRequest).clear();
});

afterAll(() => disposeGraphQLTesting(state));

describe('mutation submitSquadForReview', () => {
  const MUTATION = `
  mutation SubmitSquadForReview($sourceId: ID!) {
    submitSquadForReview(sourceId: $sourceId) {
      sourceId
      requestorId
      status
    }
  }`;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId },
      },
      'UNAUTHENTICATED',
    ));

  it('should not authorize when user is normal member', () => {
    loggedUser = '3';
    return testModeratorAuthorization({
      mutation: MUTATION,
      variables: { sourceId },
    });
  });

  it('should not authorize when user is not admin of the squad', () => {
    loggedUser = '2';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId },
      },
      'FORBIDDEN',
    );
  });

  it('should return bad request when squadID is not valid', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId: null },
      },
      'GRAPHQL_VALIDATION_FAILED',
    );
  });

  it('should fail if squadID does not match a squad', async () => {
    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId: 'invalid' },
      },
      'NOT_FOUND',
    );
  });

  it('should add new source request', async () => {
    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { sourceId },
    });
    expect(res.data.submitSquadForReview).toMatchObject({
      sourceId: sourceId,
      requestorId: loggedUser,
      status: SquadPublicRequestStatus.Pending,
    });
  });

  it('should fail if there already is a pending request', async () => {
    const repo = con.getRepository(SquadPublicRequest);
    await repo.save({
      sourceId: sourceId,
      requestorId: '1',
      status: SquadPublicRequestStatus.Pending,
    });

    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId },
      },
      'CONFLICT',
    );
  });

  it('should fail if there already is a rejected request within last 30 days', async () => {
    const repo = con.getRepository(SquadPublicRequest);
    await repo.save({
      sourceId: sourceId,
      requestorId: '1',
      status: SquadPublicRequestStatus.Rejected,
    });

    loggedUser = '1';
    return testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { sourceId },
      },
      'CONFLICT',
    );
  });

  it('should succeed if the rejected request is older than 30 days', async () => {
    const olderDate = new Date();
    olderDate.setDate(olderDate.getDate() - 31);

    const repo = con.getRepository(SquadPublicRequest);
    await repo.save({
      sourceId: sourceId,
      requestorId: '1',
      status: SquadPublicRequestStatus.Rejected,
      updatedAt: olderDate,
      createdAt: olderDate,
    });

    loggedUser = '1';
    const res = await client.mutate(MUTATION, {
      variables: { sourceId },
    });
    expect(res.data.submitSquadForReview).toMatchObject({
      sourceId: sourceId,
      requestorId: loggedUser,
      status: SquadPublicRequestStatus.Pending,
    });
  });
});

describe('query pendingSourceRequests', () => {
  const query = `query PublicSquadRequests($sourceId: String!, $first: Int) {
    publicSquadRequests(sourceId: $sourceId, first: $first) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          requestorId
          status
        }
      }
    }
  }`;

  it('should not authorize when normal member', async () => {
    loggedUser = '3';
    return testQueryErrorCode(
      client,
      { query, variables: { first: 10, sourceId } },
      'FORBIDDEN',
    );
  });

  it('should not authorize when not admin', async () => {
    loggedUser = '2';
    return testQueryErrorCode(
      client,
      { query, variables: { first: 10, sourceId } },
      'FORBIDDEN',
    );
  });

  it('should not return anything for non-matching squadId', async () => {
    loggedUser = '1';
    return testQueryErrorCode(
      client,
      { query, variables: { first: 10, sourceId: 'invalid' } },
      'NOT_FOUND',
    );
  });

  it('should return pending source requests', async () => {
    loggedUser = '1';

    await con.getRepository(SquadPublicRequest).save({
      sourceId: sourceId,
      requestorId: '2',
      status: SquadPublicRequestStatus.Rejected,
    });
    await con.getRepository(SquadPublicRequest).save({
      sourceId: sourceId,
      requestorId: '1',
      status: SquadPublicRequestStatus.Pending,
    });

    const res = await client.query(query, {
      variables: { first: 10, sourceId },
    });
    expect(res.data).toMatchObject({
      publicSquadRequests: {
        pageInfo: {
          hasNextPage: false,
        },
        edges: [
          {
            node: {
              requestorId: '1',
              status: SquadPublicRequestStatus.Pending,
            },
          },
          {
            node: {
              requestorId: '2',
              status: SquadPublicRequestStatus.Rejected,
            },
          },
        ],
      },
    });
  });
});
