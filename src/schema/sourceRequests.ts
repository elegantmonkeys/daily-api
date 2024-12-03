import { ForbiddenError, UserInputError } from 'apollo-server-errors';
import { IResolvers } from '@graphql-tools/utils';
import { v4 as uuidv4 } from 'uuid';
import {
  forwardPagination,
  PaginationResponse,
  GQLDataInput,
  GQLDataIdInput,
  GQLIdInput,
  offsetPageGenerator,
} from './common';
import { traceResolvers } from './trace';
import { AuthContext, BaseContext, Context } from '../Context';
import {
  MachineSource,
  Source,
  SourceFeed,
  SourceRequest,
  SquadPublicRequest,
  SquadPublicRequestStatus,
  User,
} from '../entity';
import { getRelayNodeInfo, uploadLogo } from '../common';
import { GraphQLResolveInfo } from 'graphql';
// @ts-expect-error - no types
import { FileUpload } from 'graphql-upload/GraphQLUpload.js';
import { GQLSubmissionAvailability, hasSubmissionAccess } from './submissions';
import {
  ConflictError,
  SourceRequestErrorMessage,
  TypeORMQueryFailedError,
} from '../errors';
import { ConnectionArguments } from 'graphql-relay';
import { SourceMemberRoles } from '../roles';
import { MoreThan } from 'typeorm';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';

export interface GQLSourceRequest {
  id: string;
  sourceUrl: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  approved?: boolean;
  closed: boolean;
  sourceId?: string;
  sourceName?: string;
  sourceImage?: string;
  sourceTwitter?: string;
  sourceFeed?: string;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GQLRequestSourceInput extends Partial<GQLSourceRequest> {
  sourceUrl: string;
}

export interface GQLUpdateSourceRequestInput extends Partial<GQLSourceRequest> {
  sourceUrl?: string;
  sourceId?: string;
  sourceName?: string;
  sourceImage?: string;
  sourceTwitter?: string;
  sourceFeed?: string;
}

export interface GQLDeclineSourceRequestInput
  extends Partial<GQLSourceRequest> {
  reason: string;
}

export type GQLSourceRequestAvailability = Pick<
  GQLSubmissionAvailability,
  'hasAccess'
>;

const REJECTED_DAYS_LIMIT = 30;

export interface GQLPublicSquadRequest {
  id: string;
  requestorId: string;
  sourceId: string;
  status: SquadPublicRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface GQLPublicSquadRequestInput {
  sourceId: string;
}

interface PublicSquadRequestsArgs
  extends ConnectionArguments,
    GQLPublicSquadRequestInput {}

export const typeDefs = /* GraphQL */ `
  """
  Community request for a new source
  """
  type SourceRequest {
    """
    Unique identifier
    """
    id: ID!

    """
    URL to the source website
    """
    sourceUrl: String!

    """
    Id of the user who requested this source
    """
    userId: ID!

    """
    Name of the user who requested this source
    """
    userName: String

    """
    Email of the user who requested this source
    """
    userEmail: String

    """
    Whether this request was approved
    """
    approved: Boolean

    """
    Whether this request is closed
    """
    closed: Boolean!

    """
    Id for the future source
    """
    sourceId: ID

    """
    Name of the future source
    """
    sourceName: String

    """
    URL for thumbnail image of the future source
    """
    sourceImage: String

    """
    Twitter handle of the future source
    """
    sourceTwitter: String

    """
    Feed (RSS/Atom) of the future source
    """
    sourceFeed: String

    """
    Reason for not accepting this request
    """
    reason: String

    """
    Time when the request was received
    """
    createdAt: DateTime!

    """
    Time of last update
    """
    updatedAt: DateTime!
  }

  type SourceRequestConnection {
    pageInfo: PageInfo!
    edges: [SourceRequestEdge!]!
  }

  type SourceRequestEdge {
    node: SourceRequest!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  type SourceRequestAvailability {
    hasAccess: Boolean!
  }

  input DeclineSourceRequestInput {
    """
    Reason for not accepting this request
    """
    reason: String!
  }

  input RequestSourceInput {
    """
    URL to the source website
    """
    sourceUrl: String! @url
  }

  input UpdateSourceRequestInput {
    """
    URL to the source website
    """
    sourceUrl: String @url

    """
    Id for the future source
    """
    sourceId: ID

    """
    Name of the future source
    """
    sourceName: String

    """
    URL for thumbnail image of the future source
    """
    sourceImage: String @url

    """
    Twitter handle of the future source
    """
    sourceTwitter: String

    """
    Feed (RSS/Atom) of the future source
    """
    sourceFeed: String @url
  }

  """
  Request for making a squad public
  """
  type PublicSquadRequest {
    """
    Unique identifier
    """
    id: ID!

    """
    Id of the user who made the request
    """
    requestorId: String!

    """
    Request status
    """
    status: String!

    """
    Id for the squad
    """
    sourceId: String!

    """
    Time when the request was received
    """
    createdAt: DateTime!

    """
    Time of last update
    """
    updatedAt: DateTime!
  }

  type PublicSquadRequestConnection {
    pageInfo: PageInfo!
    edges: [PublicSquadRequestEdge!]!
  }

  type PublicSquadRequestEdge {
    node: PublicSquadRequest!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  extend type Mutation {
    """
    Request a new source
    """
    requestSource(data: RequestSourceInput!): SourceRequest! @auth

    """
    Update the information of a source request
    """
    updateSourceRequest(
      data: UpdateSourceRequestInput!
      id: String!
    ): SourceRequest! @auth(requires: [MODERATOR])

    """
    Decline a source request
    """
    declineSourceRequest(
      data: DeclineSourceRequestInput!
      id: String!
    ): SourceRequest! @auth(requires: [MODERATOR])

    """
    Approve a source request (but doesn't publish it)
    """
    approveSourceRequest(id: String!): SourceRequest!
      @auth(requires: [MODERATOR])

    """
    Publish a source request and turn it into a source
    """
    publishSourceRequest(id: String!): SourceRequest!
      @auth(requires: [MODERATOR])

    """
    Upload a logo to a source request
    """
    uploadSourceRequestLogo(file: Upload!, id: String!): SourceRequest!
      @auth(requires: [MODERATOR])

    """
    Submit a new request to make squad public
    """
    submitSquadForReview(sourceId: ID!): PublicSquadRequest! @auth
  }

  extend type Query {
    """
    Get all pending source requests
    """
    pendingSourceRequests(
      """
      Paginate before opaque cursor
      """
      before: String

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Paginate last
      """
      last: Int
    ): SourceRequestConnection! @auth(requires: [MODERATOR])

    """
    Information regarding the access of submitting source requests
    """
    sourceRequestAvailability: SourceRequestAvailability! @auth

    """
    Get all pending source requests
    """
    publicSquadRequests(
      """
      Paginate before opaque cursor
      """
      before: String

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int

      """
      Paginate last
      """
      last: Int

      """
      Squad ID
      """
      sourceId: String!
    ): PublicSquadRequestConnection! @auth
  }
`;

const findOrFail = async (
  ctx: Context,
  id: string,
): Promise<GQLSourceRequest> => {
  const req = await ctx.getRepository(SourceRequest).findOneByOrFail({ id });
  if (req.closed) {
    throw new ForbiddenError(
      'Access denied! Source request is already closed!',
    );
  }
  return req;
};

const partialUpdateSourceRequest = async (
  ctx: Context,
  id: string,
  data: Partial<GQLSourceRequest>,
): Promise<GQLSourceRequest> => {
  const req = await findOrFail(ctx, id);
  const repo = ctx.getRepository(SourceRequest);
  return repo.save(repo.merge(req, data));
};

const createSourceFromRequest = (
  ctx: Context,
  req: SourceRequest,
): Promise<Source> =>
  ctx.con.manager.transaction(async (entityManager): Promise<Source> => {
    const source = await entityManager.getRepository(MachineSource).save({
      id: req.sourceId,
      twitter: req.sourceTwitter,
      website: req.sourceUrl,
      name: req.sourceName,
      image: req.sourceImage,
      handle: req.sourceId,
    });

    await entityManager.getRepository(SourceFeed).save({
      feed: req.sourceFeed,
      sourceId: source.id,
    });

    return source;
  });

const ensureSourceRole = async (
  ctx: Context,
  sourceId: string,
  role: SourceMemberRoles = SourceMemberRoles.Admin,
): Promise<Source> => {
  const source = await ctx.con
    .getRepository(Source)
    .findOneByOrFail([{ id: sourceId }, { handle: sourceId }]);
  const sourceMember = ctx.userId
    ? await ctx.con
        .getRepository(ContentPreferenceSource)
        .findOneBy({ referenceId: source.id, userId: ctx.userId })
    : null;

  if (!sourceMember || sourceMember.flags.role !== role) {
    throw new ForbiddenError('Access denied!');
  }

  return source;
};

const ensureNotRejected = async (
  ctx: Context,
  sourceId: string,
  lastDays = REJECTED_DAYS_LIMIT,
): Promise<void> => {
  const lastDaysMilis = 1000 * 60 * 60 * 24 * lastDays;
  const daysAgo = new Date(Date.now() - lastDaysMilis);
  const repo = ctx.getRepository(SquadPublicRequest);
  const lastRejected = await repo.findOne({
    where: {
      sourceId,
      status: SquadPublicRequestStatus.Rejected,
      updatedAt: MoreThan(daysAgo),
    },
  });

  if (lastRejected) {
    throw new ConflictError(
      `Public Squad request was rejected within the last ${lastDays} days!`,
    );
  }
};

export const resolvers: IResolvers<unknown, BaseContext> = traceResolvers<
  unknown,
  BaseContext
>({
  Mutation: {
    requestSource: async (
      source,
      { data }: GQLDataInput<GQLRequestSourceInput>,
      ctx: AuthContext,
    ): Promise<GQLSourceRequest> => {
      const user = await ctx
        .getRepository(User)
        .findOneByOrFail({ id: ctx.userId });

      if (!hasSubmissionAccess(user)) {
        throw new ForbiddenError(SourceRequestErrorMessage.ACCESS_DENIED);
      }

      const repo = ctx.getRepository(SourceRequest);
      const sourceReq = repo.create({
        sourceUrl: data.sourceUrl,
        userId: ctx.userId,
        userName: user.name,
        userEmail: user.email,
      });
      await repo.save(sourceReq);
      return sourceReq;
    },
    updateSourceRequest: async (
      source,
      { id, data }: GQLDataIdInput<GQLUpdateSourceRequestInput>,
      ctx: AuthContext,
    ): Promise<GQLSourceRequest> => {
      return partialUpdateSourceRequest(ctx, id, data);
    },
    declineSourceRequest: async (
      source,
      { id, data }: GQLDataIdInput<GQLDeclineSourceRequestInput>,
      ctx: AuthContext,
    ): Promise<GQLSourceRequest> => {
      return partialUpdateSourceRequest(ctx, id, {
        approved: false,
        closed: true,
        ...data,
      });
    },
    approveSourceRequest: async (
      source,
      { id }: GQLIdInput,
      ctx: AuthContext,
    ): Promise<GQLSourceRequest> => {
      return partialUpdateSourceRequest(ctx, id, {
        approved: true,
      });
    },
    publishSourceRequest: async (
      source,
      { id }: GQLIdInput,
      ctx: AuthContext,
    ): Promise<GQLSourceRequest> => {
      const req = await findOrFail(ctx, id);
      if (
        !req.sourceId ||
        !req.sourceName ||
        !req.sourceImage ||
        !req.sourceFeed ||
        !req.approved
      ) {
        throw new ForbiddenError(
          'Access denied! Source request cannot be published!',
        );
      }
      await createSourceFromRequest(ctx, req);
      req.closed = true;
      await ctx.getRepository(SourceRequest).save(req);
      ctx.log.info(
        {
          sourceRequest: req,
        },
        `published new source ${req.id}`,
      );
      return req;
    },
    uploadSourceRequestLogo: async (
      source,
      { id, file }: GQLIdInput & { file: FileUpload },
      ctx: AuthContext,
    ): Promise<GQLSourceRequest> => {
      const req = await findOrFail(ctx, id);
      const { createReadStream } = await file;
      const stream = createReadStream();
      const name = uuidv4().replace(/-/g, '');
      const img = await uploadLogo(name, stream);
      ctx.log.info(
        {
          sourceRequest: req,
          img,
        },
        'uploaded image for source request',
      );
      req.sourceImage = img;
      return ctx.getRepository(SourceRequest).save(req);
    },
    submitSquadForReview: async (
      _,
      { sourceId }: GQLPublicSquadRequestInput,
      ctx: AuthContext,
    ): Promise<GQLPublicSquadRequest> => {
      // we need to check that the user is squad admin, moderator is not enough
      const squad = await ensureSourceRole(
        ctx,
        sourceId,
        SourceMemberRoles.Admin,
      );

      // only create a request if squad is private
      if (!squad.private) {
        throw new UserInputError('Squad is already public!');
      }

      // make sure there is no rejected request within the last 30 days
      await ensureNotRejected(ctx, sourceId);

      const repo = ctx.getRepository(SquadPublicRequest);
      const publicReq = repo.create({
        requestorId: ctx.userId,
        sourceId,
        status: SquadPublicRequestStatus.Pending,
      });

      try {
        const result = await repo.save(publicReq);
        return result;
      } catch (originalError) {
        const err = originalError as TypeORMQueryFailedError;

        if (err.name === 'QueryFailedError' && err.code === '23505') {
          throw new ConflictError('Request already exists!');
        }
        throw err;
      }
    },
  },
  Query: {
    pendingSourceRequests: forwardPagination(
      async (
        source,
        args,
        ctx,
        { limit, offset },
        info: GraphQLResolveInfo,
      ): Promise<PaginationResponse<GQLSourceRequest>> => {
        const [rows, total] = await ctx.loader.loadManyPaginated<SourceRequest>(
          SourceRequest,
          { closed: false },
          getRelayNodeInfo(info),
          {
            limit,
            offset,
          },
          { order: { '"createdAt"': 'ASC' } },
        );
        return {
          total,
          nodes: rows,
        };
      },
      offsetPageGenerator(100, 500),
    ),
    sourceRequestAvailability: async (
      _,
      __,
      ctx: AuthContext,
    ): Promise<GQLSourceRequestAvailability> => {
      const user = await ctx
        .getRepository(User)
        .findOneByOrFail({ id: ctx.userId });

      return {
        hasAccess: hasSubmissionAccess(user),
      };
    },
    publicSquadRequests: forwardPagination(
      async (
        _,
        args,
        ctx,
        { limit, offset },
        info: GraphQLResolveInfo,
      ): Promise<PaginationResponse<GQLPublicSquadRequest>> => {
        const sourceArgs = args as PublicSquadRequestsArgs;
        // we need to check that the user is squad admin, moderator is not enough
        await ensureSourceRole(
          ctx,
          sourceArgs.sourceId,
          SourceMemberRoles.Admin,
        );

        const [rows, total] =
          await ctx.loader.loadManyPaginated<SquadPublicRequest>(
            SquadPublicRequest,
            { sourceId: sourceArgs.sourceId },
            getRelayNodeInfo(info),
            {
              limit,
              offset,
            },
            { order: { '"createdAt"': 'DESC' } },
          );
        return {
          total,
          nodes: rows,
        };
      },
      offsetPageGenerator(100, 500),
    ),
  },
});
