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
import { DataSource } from 'typeorm';
import createOrGetConnection from '../src/db';
import {
  UserIntegration,
  UserIntegrationType,
} from '../src/entity/UserIntegration';
import { usersFixture } from './fixture/user';
import { Source, SquadSource, User, SourceType, Feed } from '../src/entity';
import { Context } from '../src/Context';
import { sourcesFixture } from './fixture/source';
import { encrypt } from '../src/common';
import {
  UserSourceIntegration,
  UserSourceIntegrationSlack,
} from '../src/entity/UserSourceIntegration';
import { SourceMemberRoles } from '../src/roles';
import { addSeconds } from 'date-fns';
import { ContentPreferenceStatus } from '../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';

const slackPostMessage = jest.fn().mockResolvedValue({
  ok: true,
});

jest.mock('@slack/web-api', () => ({
  ...(jest.requireActual('@slack/web-api') as Record<string, unknown>),
  WebClient: function () {
    return {
      conversations: {
        list: jest.fn().mockResolvedValue({
          ok: true,
          channels: [
            {
              id: '1',
              name: 'channel1',
            },
            {
              id: '2',
              name: 'channel2',
            },
          ],
          response_metadata: {
            next_cursor: 'next-cursor',
          },
        }),
        info: ({ channel }) => {
          return {
            ok: true,
            channel: {
              id: channel,
            },
          };
        },
        join: jest.fn().mockResolvedValue({
          ok: true,
        }),
      },
      chat: {
        postMessage: slackPostMessage,
      },
    };
  },
}));

let con: DataSource;
let state: GraphQLTestingState;
let client: GraphQLTestClient;
let loggedUser: string | undefined;

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(
    () => new MockContext(con, loggedUser) as unknown as Context,
  );
  client = state.client;
});

beforeEach(async () => {
  loggedUser = undefined;
  jest.clearAllMocks();
});

afterAll(() => disposeGraphQLTesting(state));

const getIntegration = async ({
  type,
  userId,
}: {
  type: UserIntegrationType;
  userId: string;
}) => {
  const integration = await con.getRepository(UserIntegration).findOneByOrFail({
    type,
    userId,
  });

  return integration;
};

describe('slack integration', () => {
  beforeEach(async () => {
    const createdAt = new Date();

    await saveFixtures(con, User, usersFixture);
    await saveFixtures(
      con,
      Feed,
      usersFixture.map((user) => ({ id: user.id, userId: user.id })),
    );
    await saveFixtures(con, Source, sourcesFixture);
    await con.getRepository(UserIntegration).save([
      {
        userId: '1',
        type: UserIntegrationType.Slack,
        name: 'daily.dev',
        meta: {
          appId: 'sapp1',
          scope: 'channels:read,chat:write,channels:join',
          teamId: 'st1',
          teamName: 'daily.dev',
          tokenType: 'bot',
          accessToken: await encrypt(
            'xoxb-token',
            process.env.SLACK_DB_KEY as string,
          ),
          slackUserId: 'su1',
        },
      },
    ]);
    await con.getRepository(SquadSource).save([
      {
        id: 'squadslack',
        name: 'Squad Slack',
        image: 'http//image.com/s',
        handle: 'squadslack',
        type: SourceType.Squad,
        active: true,
        private: true,
      },
      {
        id: 'squadslack2',
        name: 'Squad Slack 2',
        image: 'http//image.com/s2',
        handle: 'squadslack2',
        type: SourceType.Squad,
        active: true,
        private: true,
      },
      {
        id: 'squadslack3',
        name: 'Squad Slack 3',
        image: 'http//image.com/s3',
        handle: 'squadslack3',
        type: SourceType.Squad,
        active: true,
        private: true,
      },
    ]);
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'squadslack',
        referenceId: 'squadslack',
        userId: '1',
        createdAt: addSeconds(createdAt, 1),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'squadslacktoken1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 'squadslack',
        referenceId: 'squadslack',
        userId: '2',
        createdAt: addSeconds(createdAt, 2),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'squadslacktoken2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
      {
        sourceId: 'squadslack',
        referenceId: 'squadslack',
        userId: '3',
        createdAt: addSeconds(createdAt, 3),
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'squadslacktoken3',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '3',
      },
    ]);
  });

  describe('query slackChannels', () => {
    const QUERY = ({ integrationId, limit = 999 }) => `
      query {
        slackChannels(integrationId: "${integrationId}", limit: ${limit}) {
          data {
            id
            name
          }
          cursor
        }
      }
    `;

    it('should require authentication', async () => {
      await testQueryErrorCode(
        client,
        {
          query: QUERY({
            integrationId: 'integration-id',
          }),
        },
        'UNAUTHENTICATED',
      );
    });

    it('should return a list of slack channels', async () => {
      loggedUser = '1';
      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      const res = await client.query(
        QUERY({
          integrationId: userIntegration.id,
        }),
      );

      expect(res.errors).toBeFalsy();
      expect(res.data.slackChannels).toMatchObject({
        data: [
          { id: '1', name: 'channel1' },
          { id: '2', name: 'channel2' },
        ],
        cursor: 'next-cursor',
      });
    });
  });

  describe('mutation slackConnectSource', () => {
    const MUTATION = ({ integrationId, channelId, sourceId }) => `
      mutation {
        slackConnectSource(
          integrationId: "${integrationId}",
          channelId: "${channelId}",
          sourceId: "${sourceId}"
        ) {
          _
        }
      }
    `;

    it('should require authentication', async () => {
      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: 'integration-id',
            channelId: 'channel-id',
            sourceId: 'source-id',
          }),
        },
        'UNAUTHENTICATED',
      );
    });

    it('should connect a slack channel to a source', async () => {
      loggedUser = '1';
      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      const res = await client.mutate(
        MUTATION({
          integrationId: userIntegration.id,
          channelId: '1',
          sourceId: 'squadslack',
        }),
      );

      expect(res.errors).toBeFalsy();
      expect(slackPostMessage).toHaveBeenCalledTimes(1);
      expect(slackPostMessage).toHaveBeenCalledWith({
        channel: '1',
        text: `Ido connected the \"<http://localhost:5002/squads/squadslack?utm_source=notification&utm_medium=slack&utm_campaign=connected&jt=squadslacktoken1&source=squadslack&type=squad|Squad Slack>\" Squad to this channel. Important updates from this Squad will be posted here 🙌`,
        unfurl_links: false,
      });
    });

    it('should update channel for source', async () => {
      loggedUser = '1';
      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      const res = await client.mutate(
        MUTATION({
          integrationId: userIntegration.id,
          channelId: '1',
          sourceId: 'squadslack',
        }),
      );

      expect(res.errors).toBeFalsy();

      const userSourceIntegration = await con
        .getRepository(UserSourceIntegration)
        .findOneByOrFail({
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
        });
      expect(userSourceIntegration).toMatchObject({
        channelIds: ['1'],
      });

      const resUpdate = await client.mutate(
        MUTATION({
          integrationId: userIntegration.id,
          channelId: '2',
          sourceId: 'squadslack',
        }),
      );

      expect(resUpdate.errors).toBeFalsy();

      const userSourceIntegrationUpdate = await con
        .getRepository(UserSourceIntegration)
        .findOneByOrFail({
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
        });
      expect(userSourceIntegrationUpdate).toMatchObject({
        channelIds: ['2'],
      });

      expect(slackPostMessage).toHaveBeenCalledTimes(2);
      expect(slackPostMessage).toHaveBeenNthCalledWith(2, {
        channel: '2',
        text: `Ido connected the \"<http://localhost:5002/squads/squadslack?utm_source=notification&utm_medium=slack&utm_campaign=connected&jt=squadslacktoken1&source=squadslack&type=squad|Squad Slack>\" Squad to this channel. Important updates from this Squad will be posted here 🙌`,
        unfurl_links: false,
      });
    });

    it('should not allow connecting source if existing connection is already present', async () => {
      loggedUser = '2';

      await con.getRepository(UserIntegration).save([
        {
          userId: '2',
          type: UserIntegrationType.Slack,
          name: 'daily.dev',
          meta: {
            appId: 'sapp1',
            scope: 'channels:read,chat:write,channels:join',
            teamId: 'st1',
            teamName: 'daily.dev',
            tokenType: 'bot',
            accessToken: await encrypt(
              'xoxb-token',
              process.env.SLACK_DB_KEY as string,
            ),
            slackUserId: 'su2',
          },
        },
      ]);
      const existingUserIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: '1',
      });
      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      await con.getRepository(UserSourceIntegrationSlack).save([
        {
          userIntegrationId: existingUserIntegration.id,
          sourceId: 'squadslack',
          channelIds: ['1'],
        },
      ]);

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: userIntegration.id,
            channelId: '1',
            sourceId: 'squadslack',
          }),
        },
        'CONFLICT',
      );
    });

    it('should allow connecting source if integration is from the same user', async () => {
      loggedUser = '1';

      const [otherIntegration] = await con.getRepository(UserIntegration).save([
        {
          userId: '1',
          type: UserIntegrationType.Slack,
          name: 'example.com',
          meta: {
            appId: 'exapp2',
            scope: 'channels:read,chat:write,channels:join',
            teamId: 'ext2',
            teamName: 'example.com',
            tokenType: 'bot',
            accessToken: await encrypt(
              'xoxb-token',
              process.env.SLACK_DB_KEY as string,
            ),
            slackUserId: 'su1',
          },
        },
      ]);
      const existingUserIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      await con.getRepository(UserSourceIntegrationSlack).save([
        {
          userIntegrationId: existingUserIntegration.id,
          sourceId: 'squadslack',
          channelIds: ['1'],
        },
      ]);

      const res = await client.mutate(
        MUTATION({
          integrationId: otherIntegration.id,
          channelId: '2',
          sourceId: 'squadslack',
        }),
      );

      const userSourceIntegrationExisting = await con
        .getRepository(UserSourceIntegrationSlack)
        .findOneBy({
          userIntegrationId: existingUserIntegration.id,
          sourceId: 'squadslack',
        });
      const userSourceIntegrationUpdate = await con
        .getRepository(UserSourceIntegrationSlack)
        .findOneByOrFail({
          userIntegrationId: otherIntegration.id,
          sourceId: 'squadslack',
        });
      expect(userSourceIntegrationUpdate).toMatchObject({
        channelIds: ['2'],
      });
      expect(userSourceIntegrationExisting).toBeNull();

      expect(res.errors).toBeFalsy();
      expect(slackPostMessage).toHaveBeenCalledTimes(1);
    });

    it('should return error if user does not have access to source', async () => {
      loggedUser = '4';

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: 'integration-id',
            channelId: '1',
            sourceId: 'squadslack',
          }),
        },
        'FORBIDDEN',
      );
    });

    it('should return error if user is not admin', async () => {
      loggedUser = '3';

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: 'integration-id',
            channelId: '1',
            sourceId: 'squadslack',
          }),
        },
        'FORBIDDEN',
      );
    });

    it('should not post join message to channel if already connected', async () => {
      loggedUser = '1';
      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      const res = await client.mutate(
        MUTATION({
          integrationId: userIntegration.id,
          channelId: '1',
          sourceId: 'squadslack',
        }),
      );

      expect(res.errors).toBeFalsy();
      expect(slackPostMessage).toHaveBeenCalledTimes(1);

      const userSourceIntegration = await con
        .getRepository(UserSourceIntegration)
        .findOneByOrFail({
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
        });
      expect(userSourceIntegration).toMatchObject({
        channelIds: ['1'],
      });

      const resUpdate = await client.mutate(
        MUTATION({
          integrationId: userIntegration.id,
          channelId: '1',
          sourceId: 'squadslack',
        }),
      );

      expect(resUpdate.errors).toBeFalsy();
      expect(slackPostMessage).toHaveBeenCalledTimes(1);
    });

    it('should return error if integration is not found', async () => {
      loggedUser = '1';

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: '4a51defd-a083-4967-82a8-edb009d57d05',
            channelId: '1',
            sourceId: 'squadslack',
          }),
        },
        'NOT_FOUND',
      );
    });
  });

  describe('query sourceIntegration', () => {
    const QUERY = ({ sourceId, type }) => `
      query {
        sourceIntegration(sourceId: "${sourceId}", type: ${type}) {
          userIntegration {
            id
            userId
          }
          type
          createdAt
          updatedAt
          source {
            id
          }
        }
      }
    `;

    it('should require authentication', async () => {
      await testQueryErrorCode(
        client,
        {
          query: QUERY({
            sourceId: 'source-id',
            type: UserIntegrationType.Slack,
          }),
        },
        'UNAUTHENTICATED',
      );
    });

    it('should return source integration', async () => {
      loggedUser = '1';

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      await con.getRepository(UserSourceIntegrationSlack).save([
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
          channelIds: ['1'],
        },
      ]);

      const res = await client.query(
        QUERY({
          sourceId: 'squadslack',
          type: UserIntegrationType.Slack,
        }),
      );

      expect(res.errors).toBeFalsy();
      expect(res.data.sourceIntegration).toMatchObject({
        userIntegration: {
          id: userIntegration.id,
          userId: userIntegration.userId,
        },
        type: UserIntegrationType.Slack,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        source: {
          id: 'squadslack',
        },
      });
    });

    it('should return error if source integration does not exist', async () => {
      loggedUser = '1';

      await testQueryErrorCode(
        client,
        {
          query: QUERY({
            sourceId: 'squadslack',
            type: UserIntegrationType.Slack,
          }),
        },
        'NOT_FOUND',
      );
    });

    it('should return error if user does not have access to source', async () => {
      loggedUser = '4';

      await testQueryErrorCode(
        client,
        {
          query: QUERY({
            sourceId: 'squadslack',
            type: UserIntegrationType.Slack,
          }),
        },
        'FORBIDDEN',
      );
    });

    it('should return error if user is not admin', async () => {
      loggedUser = '3';

      await testQueryErrorCode(
        client,
        {
          query: QUERY({
            sourceId: 'squadslack',
            type: UserIntegrationType.Slack,
          }),
        },
        'FORBIDDEN',
      );
    });

    it('should return source if user has access to private source', async () => {
      loggedUser = '1';

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });
      await con.getRepository(UserSourceIntegrationSlack).save([
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
          channelIds: ['1'],
        },
      ]);

      const res = await client.query(
        QUERY({
          sourceId: 'squadslack',
          type: UserIntegrationType.Slack,
        }),
      );

      expect(res.errors).toBeFalsy();
      expect(res.data.sourceIntegration).toMatchObject({
        userIntegration: {
          id: userIntegration.id,
          userId: userIntegration.userId,
        },
        type: UserIntegrationType.Slack,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        source: {
          id: 'squadslack',
        },
      });
    });
  });

  describe('query sourceIntegrations', () => {
    const QUERY = ({ integrationId }) => `
      query {
        sourceIntegrations(integrationId: "${integrationId}") {
          edges {
            node {
              userIntegration {
                id
                userId
              }
              type
              createdAt
              updatedAt
              source {
                id
              }
            }
          }
        }
      }
    `;

    it('should require authentication', async () => {
      await testQueryErrorCode(
        client,
        {
          query: QUERY({
            integrationId: 'integration-id',
          }),
        },
        'UNAUTHENTICATED',
      );
    });

    it('should return source integrations', async () => {
      loggedUser = '1';

      const [additionalIntegration] = await con
        .getRepository(UserIntegration)
        .save([
          {
            userId: '2',
            type: UserIntegrationType.Slack,
            name: 'daily.dev',
            meta: {
              appId: 'sapp1',
              scope: 'channels:read,chat:write,channels:join',
              teamId: 'st1',
              teamName: 'daily.dev',
              tokenType: 'bot',
              accessToken: await encrypt(
                'xoxb-token',
                process.env.SLACK_DB_KEY as string,
              ),
              slackUserId: 'su2',
            },
          },
        ]);

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      const createdAt = new Date();

      await con.getRepository(UserSourceIntegrationSlack).save([
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
          channelIds: ['1'],
          createdAt: addSeconds(createdAt, 3),
        },
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack2',
          channelIds: ['2'],
          createdAt: addSeconds(createdAt, 2),
        },
        {
          userIntegrationId: additionalIntegration.id,
          sourceId: 'squadslack3',
          channelIds: ['3'],
          createdAt: addSeconds(createdAt, 1),
        },
      ]);

      const res = await client.query(
        QUERY({
          integrationId: userIntegration.id,
        }),
      );

      expect(res.errors).toBeFalsy();
      expect(res.data.sourceIntegrations).toMatchObject({
        edges: [
          {
            node: {
              userIntegration: {
                id: userIntegration.id,
                userId: userIntegration.userId,
              },
              type: UserIntegrationType.Slack,
              createdAt: expect.any(String),
              updatedAt: expect.any(String),
              source: {
                id: 'squadslack',
              },
            },
          },
          {
            node: {
              userIntegration: {
                id: userIntegration.id,
                userId: userIntegration.userId,
              },
              type: UserIntegrationType.Slack,
              createdAt: expect.any(String),
              updatedAt: expect.any(String),
              source: {
                id: 'squadslack2',
              },
            },
          },
        ],
      });
    });
  });

  describe('mutation removeIntegration', () => {
    const MUTATION = ({ integrationId }) => `
      mutation {
        removeIntegration(integrationId: "${integrationId}") {
          _
        }
      }
    `;

    it('should require authentication', async () => {
      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: 'integration-id',
          }),
        },
        'UNAUTHENTICATED',
      );
    });

    it('should remove integration', async () => {
      loggedUser = '1';

      await con.getRepository(UserIntegration).save([
        {
          userId: '2',
          type: UserIntegrationType.Slack,
          name: 'daily.dev',
          meta: {
            appId: 'sapp1',
            scope: 'channels:read,chat:write,channels:join',
            teamId: 'st1',
            teamName: 'daily.dev',
            tokenType: 'bot',
            accessToken: await encrypt(
              'xoxb-token',
              process.env.SLACK_DB_KEY as string,
            ),
            slackUserId: 'su2',
          },
        },
      ]);

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });
      const integrationCount = await con.getRepository(UserIntegration).count();
      expect(integrationCount).toBe(2);

      const res = await client.mutate(
        MUTATION({
          integrationId: userIntegration.id,
        }),
      );

      expect(res.errors).toBeFalsy();

      const integration = await con.getRepository(UserIntegration).findOneBy({
        id: userIntegration.id,
      });
      expect(integration).toBe(null);

      const integrationCountAfter = await con
        .getRepository(UserIntegration)
        .count();
      expect(integrationCountAfter).toBe(1);
    });

    it('should return error if user does not have access to integration', async () => {
      loggedUser = '4';

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: '1',
      });

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: userIntegration.id,
          }),
        },
        'FORBIDDEN',
      );

      const integration = await con.getRepository(UserIntegration).findOneBy({
        id: userIntegration.id,
      });
      expect(integration).not.toBe(null);
    });

    it('should return error if integration is not found', async () => {
      loggedUser = '4';

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            integrationId: '4a51defd-a083-4967-82a8-edb009d57d05',
          }),
        },
        'NOT_FOUND',
      );
    });
  });

  describe('mutation removeSourceIntegration', () => {
    const MUTATION = ({ sourceId, integrationId }) => `
      mutation {
        removeSourceIntegration(sourceId: "${sourceId}", integrationId: "${integrationId}") {
          _
        }
      }
    `;

    beforeEach(async () => {
      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: '1',
      });

      await con.getRepository(UserSourceIntegrationSlack).save([
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
          channelIds: ['1'],
        },
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack2',
          channelIds: ['2'],
        },
        {
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack3',
          channelIds: ['3'],
        },
      ]);
    });

    it('should require authentication', async () => {
      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            sourceId: 'source-id',
            integrationId: 'integration-id',
          }),
        },
        'UNAUTHENTICATED',
      );
    });

    it('should remove source integration', async () => {
      loggedUser = '1';

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: loggedUser,
      });

      const sourceIntegrationCount = await con
        .getRepository(UserSourceIntegrationSlack)
        .count();
      expect(sourceIntegrationCount).toBe(3);

      const sourceIntegration = await con
        .getRepository(UserSourceIntegration)
        .findOneBy({
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
        });
      expect(sourceIntegration).not.toBe(null);

      const res = await client.mutate(
        MUTATION({
          sourceId: 'squadslack',
          integrationId: userIntegration.id,
        }),
      );

      expect(res.errors).toBeFalsy();

      const sourceIntegrationAfter = await con
        .getRepository(UserSourceIntegration)
        .findOneBy({
          userIntegrationId: userIntegration.id,
          sourceId: 'squadslack',
        });
      expect(sourceIntegrationAfter).toBe(null);

      const sourceIntegrationCountAfter = await con
        .getRepository(UserSourceIntegrationSlack)
        .count();
      expect(sourceIntegrationCountAfter).toBe(2);
    });

    it('should return error if user does not have access to integration', async () => {
      loggedUser = '4';

      const userIntegration = await getIntegration({
        type: UserIntegrationType.Slack,
        userId: '1',
      });

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            sourceId: 'squadslack',
            integrationId: userIntegration.id,
          }),
        },
        'FORBIDDEN',
      );
    });

    it('should return error if integration is not found', async () => {
      loggedUser = '4';

      await testMutationErrorCode(
        client,
        {
          mutation: MUTATION({
            sourceId: 'squadslack',
            integrationId: '4a51defd-a083-4967-82a8-edb009d57d05',
          }),
        },
        'NOT_FOUND',
      );
    });
  });
});
