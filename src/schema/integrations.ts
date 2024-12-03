import { IResolvers } from '@graphql-tools/utils';
import { AuthContext, BaseContext } from '../Context';
import { traceResolvers } from './trace';
import { logger } from '../logger';
import {
  getSlackClient,
  getLimit,
  getSlackIntegrationOrFail,
  GQLUserIntegration,
  toGQLEnum,
  addNotificationUtm,
  addPrivateSourceJoinParams,
  SlackChannelType,
  SlackOAuthScope,
} from '../common';
import { GQLEmptyResponse } from './common';
import { ForbiddenError, ValidationError } from 'apollo-server-errors';
import {
  UserSourceIntegration,
  UserSourceIntegrationSlack,
} from '../entity/UserSourceIntegration';
import { ConflictError } from '../errors';
import graphorm from '../graphorm';
import {
  UserIntegration,
  UserIntegrationSlack,
  UserIntegrationType,
} from '../entity/UserIntegration';
import {
  ensureSourcePermissions,
  GQLSource,
  SourcePermissions,
} from './sources';
import { SourceType } from '../entity';
import { Connection, ConnectionArguments } from 'graphql-relay';
import {
  GQLDatePageGeneratorConfig,
  queryPaginatedByDate,
} from '../common/datePageGenerator';
import { ConversationsInfoResponse } from '@slack/web-api';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { SourceMemberRoles } from '../roles';

export type GQLSlackChannels = {
  id?: string;
  name?: string;
};

export type GQLSlackChannelConnection = {
  data: GQLSlackChannels[];
  cursor?: string;
};

export type GQLUserSourceIntegration = Pick<
  UserSourceIntegration,
  'type' | 'createdAt' | 'updatedAt'
> & {
  userIntegration: GQLUserIntegration;
  source: GQLSource;
  channelIds: string[];
};

export const typeDefs = /* GraphQL */ `
  ${toGQLEnum(UserIntegrationType, 'UserIntegrationType')}

  type SlackChannel {
    id: String
    name: String
  }

  type SlackChannelConnection {
    """
    Channels list
    """
    data: [SlackChannel!]!

    """
    Next page cursor, if exists
    """
    cursor: String
  }

  type UserSourceIntegration {
    userIntegration: UserIntegration!
    type: String!
    createdAt: DateTime
    updatedAt: DateTime
    source: Source!
    channelIds: [String!]
  }

  type UserSourceIntegrationEdge {
    node: UserSourceIntegration!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  type UserSourceIntegrationConnection {
    pageInfo: PageInfo!
    edges: [UserSourceIntegrationEdge!]!
  }

  extend type Query {
    """
    Get slack channels
    """
    slackChannels(
      """
      ID of slack integration to use
      """
      integrationId: ID!

      """
      Number of channels to return
      """
      limit: Int = 10

      """
      Cursor for pagination
      """
      cursor: String
    ): SlackChannelConnection @auth

    """
    Get source integration
    """
    sourceIntegration(
      """
      ID of source
      """
      sourceId: ID!

      """
      Type of integration
      """
      type: UserIntegrationType!
    ): UserSourceIntegration @auth

    """
    Get source integrations
    """
    sourceIntegrations(
      """
      ID of integration
      """
      integrationId: ID!
    ): UserSourceIntegrationConnection @auth
  }

  extend type Mutation {
    """
    Connect source to slack channel
    """
    slackConnectSource(
      """
      ID of slack integration to use
      """
      integrationId: ID!

      """
      ID of slack channel to connect
      """
      channelId: ID!

      """
      ID of source to connect
      """
      sourceId: ID!
    ): EmptyResponse! @auth

    """
    Remove integration
    """
    removeIntegration(
      """
      ID of integration to remove
      """
      integrationId: ID!
    ): EmptyResponse! @auth

    """
    Remove source integration
    """
    removeSourceIntegration(
      """
      ID of source to remove integration from
      """
      sourceId: ID!

      """
      ID of integration connected to source
      """
      integrationId: ID!
    ): EmptyResponse! @auth
  }
`;

export const resolvers: IResolvers<unknown, BaseContext> = traceResolvers<
  unknown,
  BaseContext
>({
  Query: {
    slackChannels: async (
      _,
      args: { integrationId: string; limit: number; cursor: string },
      ctx: AuthContext,
    ): Promise<GQLSlackChannelConnection> => {
      const slackIntegration = await getSlackIntegrationOrFail({
        id: args.integrationId,
        userId: ctx.userId,
        con: ctx.con,
      });

      const client = await getSlackClient({
        integration: slackIntegration,
      });

      const channelTypes = [SlackChannelType.Public];

      if (slackIntegration.meta.scope.includes(SlackOAuthScope.GroupsRead)) {
        channelTypes.push(SlackChannelType.Private);
      }

      const result = await client.conversations.list({
        limit: getLimit({
          limit: args.limit,
          defaultLimit: 10,
          max: 999,
        }),
        cursor: args.cursor,
        exclude_archived: true,
        types: channelTypes.join(','),
      });

      if (!result.ok) {
        const message = 'failed to fetch slack channels';

        logger.error(
          {
            err: new Error(result.error),
          },
          message,
        );

        throw new Error(message);
      }

      return {
        data: result.channels!.map((channel) => {
          return {
            id: channel.id,
            name: channel.name,
          };
        }),
        cursor: result.response_metadata?.next_cursor,
      };
    },
    sourceIntegration: async (
      _,
      args: { sourceId: string; type: UserIntegrationType },
      ctx: AuthContext,
      info,
    ): Promise<GQLUserSourceIntegration | null> => {
      await ensureSourcePermissions(
        ctx,
        args.sourceId,
        SourcePermissions.ConnectSlack,
      );

      return graphorm.queryOneOrFail<GQLUserSourceIntegration>(
        ctx,
        info,
        (builder) => ({
          ...builder,
          queryBuilder: builder.queryBuilder
            .where(`"${builder.alias}"."sourceId" = :id`, { id: args.sourceId })
            .andWhere(`"${builder.alias}"."type" = :type`, { type: args.type }),
        }),
      );
    },
    sourceIntegrations: async (
      _,
      args: { integrationId: string } & ConnectionArguments,
      ctx: AuthContext,
      info,
    ): Promise<Connection<GQLUserSourceIntegration>> => {
      return queryPaginatedByDate(
        ctx,
        info,
        args,
        { key: 'createdAt' } as GQLDatePageGeneratorConfig<
          GQLUserSourceIntegration,
          'createdAt'
        >,
        {
          queryBuilder: (builder) => {
            builder.queryBuilder = builder.queryBuilder
              .innerJoin(
                UserIntegration,
                'ui',
                `"${builder.alias}"."userIntegrationId" = ui.id`,
              )
              .andWhere(`ui."userId" = :integrationUserId`, {
                integrationUserId: ctx.userId,
              })
              .andWhere(
                `${builder.alias}."userIntegrationId" = :integrationId`,
                {
                  integrationId: args.integrationId,
                },
              );
            return builder;
          },
          orderByKey: 'DESC',
        },
      );
    },
  },
  Mutation: {
    slackConnectSource: async (
      _,
      args: { integrationId: string; channelId: string; sourceId: string },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      const source = await ensureSourcePermissions(
        ctx,
        args.sourceId,
        SourcePermissions.ConnectSlack,
      );

      const [slackIntegration, existingSourceIntegration, sourceAdmin] =
        await Promise.all([
          ctx.con.getRepository(UserIntegrationSlack).findOneOrFail({
            where: {
              id: args.integrationId,
              userId: ctx.userId,
            },
            relations: {
              user: true,
            },
          }),
          ctx.con.getRepository(UserSourceIntegrationSlack).findOne({
            where: {
              sourceId: args.sourceId,
            },
            relations: {
              userIntegration: true,
            },
          }),
          source.private && source.type === SourceType.Squad
            ? ctx.con
                .getRepository(ContentPreferenceSource)
                .createQueryBuilder()
                .select('flags')
                .where('"referenceId" = :sourceId', {
                  sourceId: args.sourceId,
                })
                .andWhere(`flags->>'role' = :role`, {
                  role: SourceMemberRoles.Admin,
                })
                .orderBy('"createdAt"', 'ASC')
                .getRawOne<Pick<ContentPreferenceSource, 'flags'>>()
            : null,
        ]);
      const user = await slackIntegration.user;
      const existingUserIntegration = existingSourceIntegration
        ? await existingSourceIntegration.userIntegration
        : undefined;

      if (
        existingSourceIntegration &&
        existingSourceIntegration.userIntegrationId !== slackIntegration.id &&
        existingUserIntegration &&
        existingUserIntegration.userId !== slackIntegration.userId
      ) {
        throw new ConflictError('source already connected to a channel');
      }

      const client = await getSlackClient({
        integration: slackIntegration,
      });

      let channelResult: ConversationsInfoResponse | undefined;

      try {
        channelResult = await client.conversations.info({
          channel: args.channelId,
        });

        if (!channelResult.ok) {
          throw new Error(channelResult.error);
        }
      } catch {
        throw new ValidationError('invalid channel');
      }

      const record: Partial<UserSourceIntegrationSlack> = {
        userIntegrationId: slackIntegration.id,
        // only one channel per source is allowed currently
        channelIds: [args.channelId],
      };

      if (existingSourceIntegration) {
        await ctx.con.getRepository(UserSourceIntegrationSlack).update(
          {
            sourceId: args.sourceId,
            userIntegrationId: existingUserIntegration!.id,
          },
          record,
        );
      } else {
        await ctx.con.getRepository(UserSourceIntegrationSlack).insert({
          ...record,
          sourceId: args.sourceId,
        });
      }

      if (!channelResult.channel?.is_member) {
        await client.conversations.join({
          channel: args.channelId,
        });
      }

      const channelChanged =
        existingSourceIntegration?.channelIds?.[0] !== args.channelId;

      if (channelChanged) {
        const sourceTypeName =
          source.type === SourceType.Squad ? 'Squad' : 'source';

        const squadLinkUrl = new URL(
          `${process.env.COMMENTS_PREFIX}/${sourceTypeName === 'Squad' ? 'squads' : 'sources'}/${source.handle}`,
        );
        let squadLink = addNotificationUtm(
          squadLinkUrl.toString(),
          'slack',
          'connected',
        );

        if (sourceAdmin?.flags.referralToken) {
          squadLink = addPrivateSourceJoinParams({
            url: squadLink,
            source,
            referralToken: sourceAdmin?.flags.referralToken,
          });
        }

        await client.chat.postMessage({
          channel: args.channelId,
          text: `${user.name || user.username} connected the "<${squadLink}|${source.name}>" ${sourceTypeName} to this channel. Important updates from this ${sourceTypeName} will be posted here 🙌`,
          unfurl_links: false,
        });
      }

      return { _: true };
    },
    removeIntegration: async (
      _,
      args: { integrationId: string },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      const integration = await ctx.con
        .getRepository(UserIntegration)
        .findOneByOrFail({
          id: args.integrationId,
        });

      if (integration.userId !== ctx.userId) {
        throw new ForbiddenError('not allowed');
      }

      await ctx.con.getRepository(UserIntegration).delete({
        id: integration.id,
        userId: ctx.userId,
      });

      return { _: true };
    },
    removeSourceIntegration: async (
      _,
      args: { sourceId: string; integrationId: string },
      ctx: AuthContext,
    ): Promise<GQLEmptyResponse> => {
      const integration = await ctx.con
        .getRepository(UserIntegration)
        .findOneByOrFail({
          id: args.integrationId,
        });

      if (integration.userId !== ctx.userId) {
        throw new ForbiddenError('not allowed');
      }

      await ctx.con.getRepository(UserSourceIntegration).delete({
        sourceId: args.sourceId,
        userIntegrationId: integration.id,
      });

      return { _: true };
    },
  },
});
