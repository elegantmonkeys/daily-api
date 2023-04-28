import { DataSource } from 'typeorm';
import { Action, ActionType } from '../src/entity';
import createOrGetConnection from '../src/db';
import {
  disposeGraphQLTesting,
  GraphQLTestClient,
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';

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

afterAll(() => disposeGraphQLTesting(state));

beforeEach(async () => {
  loggedUser = null;
});

describe('query actions', () => {
  const QUERY = `{
    actions {
      type
      completedAt
    }
  }`;

  it('should return alerts default values if anonymous', () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return user alerts', async () => {
    loggedUser = '1';

    const completedAt = new Date('2020-09-21T07:15:51.247Z');
    const repo = con.getRepository(Action);
    const alerts = repo.create({
      userId: loggedUser,
      completedAt,
      type: ActionType.Notification,
    });
    const expected = await repo.save(alerts);
    const res = await client.query(QUERY);
    const [action] = res.data.actions;

    expect(expected.userId).toEqual(action.userId);
    expect(expected.type).toEqual(action.type);
    expect(expected.completedAt).toEqual(action.completedAt);
  });
});

describe('mutation completeAction', () => {
  const MUTATION = `
    mutation CompleteAction($type: String!) {
      completeAction(type: $type) {
        _
      }
    }
  `;

  it('should not authorize when not logged in', () =>
    testMutationErrorCode(
      client,
      { mutation: MUTATION, variables: { type: ActionType.Notification } },
      'UNAUTHENTICATED',
    ));

  it('should record when the action is completed', async () => {
    loggedUser = '1';
    const type = ActionType.Notification;
    await client.mutate(MUTATION, { variables: { type } });
    const action = await con
      .getRepository(Action)
      .findOneBy({ userId: loggedUser, type });
    expect(action.type).toEqual(type);
  });

  it('should ignore when record is already completed', async () => {
    loggedUser = '1';
    const type = ActionType.Notification;
    await client.mutate(MUTATION, { variables: { type } });
    const action = await con
      .getRepository(Action)
      .findOneBy({ userId: loggedUser, type });
    expect(action.type).toEqual(type);
    const res = await client.mutate(MUTATION, { variables: { type } });
    expect(res.errors).toBeFalsy();
  });
});
