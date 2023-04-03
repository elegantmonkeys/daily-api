import { ForbiddenError, ValidationError } from 'apollo-server-errors';
import { IResolvers } from '@graphql-tools/utils';
import { ConnectionArguments } from 'graphql-relay';
import { traceResolverObject } from './trace';
import { Context } from '../Context';
import {
  createSharePost,
  generateMemberToken,
  Source,
  SourceFeed,
  SourceMember,
  SourceType,
  SquadSource,
} from '../entity';
import { SourceMemberRoles, sourceRoleRank } from '../roles';
import {
  forwardPagination,
  GQLEmptyResponse,
  offsetPageGenerator,
  PaginationResponse,
} from './common';
import graphorm from '../graphorm';
import {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityNotFoundError,
} from 'typeorm';
import { GQLUser } from './users';
import { Connection } from 'graphql-relay/index';
import { createDatePageGenerator } from '../common/datePageGenerator';
import { FileUpload } from 'graphql-upload/GraphQLUpload';
import { randomUUID } from 'crypto';
import { getSourceLink, uploadSquadImage } from '../common';
import { GraphQLResolveInfo } from 'graphql';
import { TypeOrmError } from '../errors';
import {
  descriptionRegex,
  handleRegex,
  nameRegex,
  validateRegex,
  ValidateRegex,
} from '../common/object';

export interface GQLSource {
  id: string;
  type: SourceType;
  name: string;
  handle: string;
  image?: string;
  private: boolean;
  public: boolean;
  members?: Connection<GQLSourceMember>;
  currentMember?: GQLSourceMember;
  privilegedMembers?: GQLSourceMember[];
}

export interface GQLSourceMember {
  source: GQLSource;
  user: GQLUser;
  role: SourceMemberRoles;
  createdAt: Date;
  referralToken: string;
}

interface UpdateMemberRoleArgs {
  sourceId: string;
  memberId: string;
  role: SourceMemberRoles;
}

export const typeDefs = /* GraphQL */ `
  """
  Source to discover posts from (usually blogs)
  """
  type Source {
    """
    Short unique string to identify the source
    """
    id: ID!

    """
    Source type (machine/squad)
    """
    type: String!

    """
    Name of the source
    """
    name: String!

    """
    URL to an avatar image of the source
    """
    image: String!

    """
    Whether the source is public
    """
    public: Boolean

    """
    Whether the source is active or not (applicable for squads)
    """
    active: Boolean

    """
    Source handle (applicable for squads)
    """
    handle: String!

    """
    Source description
    """
    description: String

    """
    Source members
    """
    members: SourceMemberConnection

    """
    URL to the source page
    """
    permalink: String!

    """
    Number of members in the source
    """
    membersCount: Int!

    """
    Logged-in member object
    """
    currentMember: SourceMember

    """
    Privileged members
    """
    privilegedMembers: [SourceMember]
  }

  type SourceConnection {
    pageInfo: PageInfo!
    edges: [SourceEdge!]!
  }

  type SourceEdge {
    node: Source!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  type SourceMember {
    """
    Relevant user who is part of the source
    """
    user: User!
    """
    Source the user belongs to
    """
    source: Source!
    """
    Role of this user in the source
    """
    role: String!
    """
    Token to be used for inviting new squad members
    """
    referralToken: String!
    """
    Numerical representation of the user's role
    """
    roleRank: Int
    """
    User squad permissions
    """
    permissions: [String]
  }

  type SourceMemberConnection {
    pageInfo: PageInfo!
    edges: [SourceMemberEdge!]!
  }

  type SourceMemberEdge {
    node: SourceMember!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  extend type Query {
    """
    Get all available sources
    """
    sources(
      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): SourceConnection!

    """
    Get the source that matches the feed
    """
    sourceByFeed(feed: String!): Source @auth

    """
    Get source by ID
    """
    source(id: ID!): Source

    """
    Get source members
    """
    sourceMembers(
      """
      Source ID
      """
      sourceId: ID!

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): SourceMemberConnection!

    """
    Get the logged in user source memberships
    """
    mySourceMemberships(
      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): SourceMemberConnection! @auth

    """
    Get source member by referral token
    """
    sourceMemberByToken(token: String!): SourceMember!

    """
    Check if source handle already exists
    """
    sourceHandleExists(handle: String!): Boolean! @auth
  }

  extend type Mutation {
    """
    Creates a new squad
    """
    createSquad(
      """
      Name for the squad
      """
      name: String!
      """
      Unique handle
      """
      handle: String!
      """
      Description for the squad (max 250 chars)
      """
      description: String
      """
      Avatar image for the squad
      """
      image: Upload
      """
      First post to share in the squad
      """
      postId: ID
      """
      Commentary for the first share
      """
      commentary: String
      """
      Rank required for members to post
      """
      memberPostingRank: Int
    ): Source! @auth

    """
    Edit a squad
    """
    editSquad(
      """
      Source to edit
      """
      sourceId: ID!
      """
      Name for the squad
      """
      name: String!
      """
      Unique handle
      """
      handle: String!
      """
      Description for the squad (max 250 chars)
      """
      description: String
      """
      Avatar image for the squad
      """
      image: Upload
    ): Source! @auth

    """
    Set the source member's current role
    """
    updateMemberRole(
      """
      Relevant source the user to update role is a member of
      """
      sourceId: ID!

      """
      Member to update
      """
      memberId: ID!

      """
      Role to update the user to
      """
      role: String!
    ): EmptyResponse! @auth

    """
    Adds the logged-in user as member to the source
    """
    joinSource(
      """
      Source to join
      """
      sourceId: ID!
      """
      Referral token (required for private squads)
      """
      token: String
    ): Source! @auth

    """
    Deletes a squad
    """
    deleteSource(
      """
      Source to delete
      """
      sourceId: ID!
    ): EmptyResponse! @auth

    """
    Removes the logged-in user as a member from the source
    """
    leaveSource(
      """
      Source to leave
      """
      sourceId: ID!
    ): EmptyResponse! @auth
  }
`;

const sourceToGQL = (source: Source): GQLSource => ({
  ...source,
  public: !source.private,
  members: undefined,
});

export enum SourcePermissions {
  CommentDelete = 'comment_delete',
  View = 'view',
  Post = 'post',
  PostLimit = 'post_limit',
  PostDelete = 'post_delete',
  MemberRemove = 'member_remove',
  MemberRoleUpdate = 'member_role_update',
  InviteDisable = 'invite_disable',
  Leave = 'leave',
  Delete = 'delete',
  Edit = 'edit',
}

const memberPermissions = [
  SourcePermissions.View,
  SourcePermissions.Post,
  SourcePermissions.Leave,
];
const moderatorPermissions = [
  ...memberPermissions,
  SourcePermissions.CommentDelete,
  SourcePermissions.PostDelete,
  SourcePermissions.MemberRemove,
  SourcePermissions.Edit,
];
const ownerPermissions = [
  ...moderatorPermissions,
  SourcePermissions.MemberRoleUpdate,
  SourcePermissions.PostLimit,
  SourcePermissions.InviteDisable,
  SourcePermissions.Delete,
];

export const roleSourcePermissions: Record<
  SourceMemberRoles,
  SourcePermissions[]
> = {
  owner: ownerPermissions,
  moderator: moderatorPermissions,
  member: memberPermissions,
  blocked: [],
};

const requireGreaterAccessPrivilege: Partial<
  Record<SourcePermissions, boolean>
> = {
  [SourcePermissions.MemberRemove]: true,
};

type BaseSourceMember = Pick<SourceMember, 'role'>;

export const hasGreaterAccess = (
  loggedUser: BaseSourceMember,
  member: BaseSourceMember,
): boolean => {
  const memberRank = sourceRoleRank[member.role];
  const loggedUserRank = sourceRoleRank[loggedUser.role];

  return loggedUserRank > memberRank;
};

export const hasGreaterAccessCheck = (
  loggedUser: BaseSourceMember,
  member: BaseSourceMember,
) => {
  if (loggedUser.role === SourceMemberRoles.Owner) {
    return;
  }

  if (!hasGreaterAccess(loggedUser, member)) {
    throw new ForbiddenError('Access denied!');
  }
};

const hasPermissionCheck = (
  source: Source | GQLSource,
  member: BaseSourceMember,
  permission: SourcePermissions,
  validateRankAgainst?: BaseSourceMember,
) => {
  if (validateRankAgainst) {
    hasGreaterAccessCheck(member, validateRankAgainst);
  }

  const rolePermissions = roleSourcePermissions[member.role];

  return rolePermissions?.includes?.(permission);
};

export const canAccessSource = async (
  ctx: Context,
  source: Source,
  sourceMember: SourceMember,
  permission: SourcePermissions,
  validateRankAgainstId?: string,
): Promise<boolean> => {
  if (permission === SourcePermissions.View && !source.private) {
    return true;
  }

  if (!ctx.userId) {
    return false;
  }

  const sourceId = source.id;
  const repo = ctx.getRepository(SourceMember);
  const validateRankAgainst = await (requireGreaterAccessPrivilege[permission]
    ? repo.findOneByOrFail({ sourceId, userId: validateRankAgainstId })
    : Promise.resolve(null));

  if (!sourceMember) {
    return false;
  }

  return hasPermissionCheck(
    source,
    sourceMember,
    permission,
    validateRankAgainst,
  );
};

export const canPostToSquad = (
  ctx: Context,
  squad: SquadSource,
  sourceMember: SourceMember,
): boolean => {
  if (!sourceMember) {
    return false;
  }

  return sourceRoleRank[sourceMember.role] >= squad.memberPostingRank;
};

const validateSquadData = ({
  handle,
  name,
  description,
}: Pick<SquadSource, 'handle' | 'name' | 'description'>): string => {
  handle = handle.replace('@', '').trim();
  const regexParams: ValidateRegex[] = [
    ['name', name, nameRegex, true],
    ['handle', handle, handleRegex, true],
    ['description', description, descriptionRegex, false],
  ];

  validateRegex(regexParams);

  return handle;
};

export const ensureSourcePermissions = async (
  ctx: Context,
  sourceId: string | undefined,
  permission: SourcePermissions = SourcePermissions.View,
  validateRankAgainstId?: string,
): Promise<Source> => {
  if (sourceId) {
    const source = await ctx.con
      .getRepository(Source)
      .findOneByOrFail([{ id: sourceId }, { handle: sourceId }]);
    const sourceMember = await ctx.con
      .getRepository(SourceMember)
      .findOneBy({ sourceId: source.id, userId: ctx.userId });

    const canAccess = await canAccessSource(
      ctx,
      source,
      sourceMember,
      permission,
      validateRankAgainstId,
    );

    if (!canAccess) {
      throw new ForbiddenError('Access denied!');
    }

    if (
      source.type === SourceType.Squad &&
      permission === SourcePermissions.Post &&
      !canPostToSquad(ctx, source, sourceMember)
    ) {
      throw new ForbiddenError('Posting not allowed!');
    }

    return source;
  }
  throw new ForbiddenError('Access denied!');
};

const sourceByFeed = async (feed: string, ctx: Context): Promise<GQLSource> => {
  const res = await ctx.con
    .createQueryBuilder()
    .select('source.*')
    .from(Source, 'source')
    .innerJoin(SourceFeed, 'sf', 'source.id = sf."sourceId"')
    .where('sf.feed = :feed and source.private = false', { feed })
    .getRawOne();
  return res ? sourceToGQL(res) : null;
};

const membershipsPageGenerator = createDatePageGenerator<
  GQLSourceMember,
  'createdAt'
>({
  key: 'createdAt',
});

type CreateSquadArgs = {
  name: string;
  handle: string;
  description?: string;
  image?: FileUpload;
  postId?: string;
  commentary?: string;
  memberPostingRank?: number;
};

type EditSquadArgs = {
  sourceId: string;
  name: string;
  handle: string;
  description?: string;
  image?: FileUpload;
};

const getSourceById = async (
  ctx: Context,
  info: GraphQLResolveInfo,
  id: string,
): Promise<GQLSource> => {
  const res = await graphorm.query<GQLSource>(ctx, info, (builder) => {
    builder.queryBuilder = builder.queryBuilder
      .andWhere('(id = :id or handle = :id)', { id })
      .limit(1);
    return builder;
  });
  if (!res.length) {
    throw new EntityNotFoundError(Source, 'not found');
  }
  return res[0];
};

const addNewSourceMember = async (
  con: DataSource | EntityManager,
  member: Omit<DeepPartial<SourceMember>, 'referralToken'>,
): Promise<void> => {
  await con.getRepository(SourceMember).insert({
    ...member,
    referralToken: await generateMemberToken(),
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resolvers: IResolvers<any, Context> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Query: traceResolverObject<any, any>({
    sources: forwardPagination(
      async (
        source,
        args: ConnectionArguments,
        ctx,
        { limit, offset },
      ): Promise<PaginationResponse<GQLSource>> => {
        const res = await ctx.con.getRepository(Source).find({
          where: { active: true },
          order: { name: 'ASC' },
          take: limit,
          skip: offset,
        });
        return {
          nodes: res.map(sourceToGQL),
        };
      },
      offsetPageGenerator(100, 500),
    ),
    sourceByFeed: async (
      _,
      { feed }: { feed: string },
      ctx,
    ): Promise<GQLSource> => sourceByFeed(feed, ctx),
    source: async (
      _,
      { id }: { id: string },
      ctx,
      info,
    ): Promise<GQLSource> => {
      await ensureSourcePermissions(ctx, id);
      return getSourceById(ctx, info, id);
    },
    sourceHandleExists: async (_, { handle }: { handle: string }, ctx) => {
      validateRegex([['handle', handle, handleRegex, true]]);

      const source = await ctx
        .getRepository(Source)
        .findOneBy({ handle: handle.toLowerCase() });

      return !!source;
    },
    sourceMembers: async (
      _,
      args: ConnectionArguments & { sourceId: string },
      ctx,
      info,
    ): Promise<Connection<GQLSourceMember>> => {
      await ensureSourcePermissions(ctx, args.sourceId);
      const page = membershipsPageGenerator.connArgsToPage(args);
      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) => membershipsPageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) => membershipsPageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          membershipsPageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder
            .andWhere(`${builder.alias}."sourceId" = :source`, {
              source: args.sourceId,
            })
            .andWhere(
              `${
                graphorm.mappings.SourceMember.fields.roleRank.select as string
              } >= 0`,
            )
            .addOrderBy(
              graphorm.mappings.SourceMember.fields.roleRank.select as string,
              'DESC',
            )
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          builder.queryBuilder.limit(page.limit);
          if (page.timestamp) {
            builder.queryBuilder = builder.queryBuilder.andWhere(
              `${builder.alias}."createdAt" < :timestamp`,
              { timestamp: page.timestamp },
            );
          }
          return builder;
        },
      );
    },
    mySourceMemberships: async (
      _,
      args: ConnectionArguments,
      ctx,
      info,
    ): Promise<Connection<GQLSourceMember>> => {
      const page = membershipsPageGenerator.connArgsToPage(args);
      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) => membershipsPageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) => membershipsPageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          membershipsPageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder
            .andWhere(`${builder.alias}."userId" = :user`, { user: ctx.userId })
            .andWhere(
              `${
                graphorm.mappings.SourceMember.fields.roleRank.select as string
              } >= 0`,
            )
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          builder.queryBuilder.limit(page.limit);
          if (page.timestamp) {
            builder.queryBuilder = builder.queryBuilder.andWhere(
              `${builder.alias}."createdAt" < :timestamp`,
              { timestamp: page.timestamp },
            );
          }
          return builder;
        },
      );
    },
    sourceMemberByToken: async (
      _,
      { token }: { token: string },
      ctx,
      info,
    ): Promise<GQLSourceMember> => {
      const res = await graphorm.query<GQLSourceMember>(
        ctx,
        info,
        (builder) => {
          builder.queryBuilder = builder.queryBuilder
            .andWhere({ referralToken: token })
            .limit(1);
          return builder;
        },
      );
      if (!res.length) {
        throw new EntityNotFoundError(SourceMember, 'not found');
      }
      return res[0];
    },
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Mutation: traceResolverObject<any, any>({
    createSquad: async (
      _,
      {
        name,
        handle: inputHandle,
        commentary,
        image,
        postId,
        description,
        memberPostingRank = 0,
      }: CreateSquadArgs,
      ctx,
      info,
    ): Promise<GQLSource> => {
      const handle = validateSquadData({
        handle: inputHandle,
        name,
        description,
      });
      try {
        const sourceId = await ctx.con.transaction(async (entityManager) => {
          const id = randomUUID();
          const repo = entityManager.getRepository(SquadSource);
          // Create a new source
          await repo.insert({
            id,
            name,
            handle,
            active: true,
            description,
            private: true,
            memberPostingRank,
          });
          // Add the logged-in user as owner
          await addNewSourceMember(entityManager, {
            sourceId: id,
            userId: ctx.userId,
            role: SourceMemberRoles.Owner,
          });
          if (postId) {
            // Create the first post of the squad
            await createSharePost(
              entityManager,
              id,
              ctx.userId,
              postId,
              commentary,
            );
          }
          // Upload the image (if provided)
          if (image) {
            const { createReadStream } = await image;
            const stream = createReadStream();
            const imageUrl = await uploadSquadImage(id, stream);
            await repo.update({ id }, { image: imageUrl });
          }
          return id;
        });
        return getSourceById(ctx, info, sourceId);
      } catch (err) {
        if (err.code === TypeOrmError.DUPLICATE_ENTRY) {
          if (err.message.indexOf('source_handle') > -1) {
            throw new ValidationError(
              JSON.stringify({ handle: 'handle is already used' }),
            );
          }
        }
        throw err;
      }
    },
    editSquad: async (
      _,
      {
        sourceId,
        name,
        handle: inputHandle,
        image,
        description,
      }: EditSquadArgs,
      ctx,
      info,
    ): Promise<GQLSource> => {
      await ensureSourcePermissions(ctx, sourceId, SourcePermissions.Edit);
      const handle = validateSquadData({
        handle: inputHandle,
        name,
        description,
      });

      try {
        const editedSourceId = await ctx.con.transaction(
          async (entityManager) => {
            const repo = entityManager.getRepository(SquadSource);
            // Update existing squad
            await repo.update(
              { id: sourceId },
              {
                name,
                handle,
                description,
              },
            );
            // Upload the image (if provided)
            if (image) {
              const { createReadStream } = await image;
              const stream = createReadStream();
              const imageUrl = await uploadSquadImage(sourceId, stream);
              await repo.update({ id: sourceId }, { image: imageUrl });
            }
            return sourceId;
          },
        );
        return getSourceById(ctx, info, editedSourceId);
      } catch (err) {
        if (err.code === TypeOrmError.DUPLICATE_ENTRY) {
          if (err.message.indexOf('source_handle') > -1) {
            throw new ValidationError(
              JSON.stringify({ handle: 'handle is already used' }),
            );
          }
        }
        throw err;
      }
    },
    deleteSource: async (
      _,
      { sourceId }: { sourceId: string },
      ctx,
    ): Promise<GQLEmptyResponse> => {
      await ensureSourcePermissions(ctx, sourceId, SourcePermissions.Delete);
      await ctx.con.getRepository(Source).delete({
        id: sourceId,
      });
      return { _: true };
    },
    leaveSource: async (
      _,
      { sourceId }: { sourceId: string },
      ctx,
    ): Promise<GQLEmptyResponse> => {
      await ensureSourcePermissions(ctx, sourceId, SourcePermissions.Leave);
      await ctx.con.getRepository(SourceMember).delete({
        sourceId,
        userId: ctx.userId,
      });
      return { _: true };
    },
    updateMemberRole: async (
      _,
      { sourceId, memberId, role }: UpdateMemberRoleArgs,
      ctx,
    ): Promise<GQLEmptyResponse> => {
      if (role === SourceMemberRoles.Blocked) {
        await ensureSourcePermissions(
          ctx,
          sourceId,
          SourcePermissions.MemberRemove,
          memberId,
        );
      } else {
        await ensureSourcePermissions(
          ctx,
          sourceId,
          SourcePermissions.MemberRoleUpdate,
        );

        if (!Object.values(SourceMemberRoles).includes(role)) {
          throw new ValidationError('Role does not exist!');
        }
      }

      await ctx.con
        .getRepository(SourceMember)
        .update({ sourceId, userId: memberId }, { role });

      return { _: true };
    },
    joinSource: async (
      _,
      { sourceId, token }: { sourceId: string; token: string },
      ctx,
      info,
    ): Promise<GQLSource> => {
      const source = await ctx.con
        .getRepository(Source)
        .findOneByOrFail({ id: sourceId });
      if (source.type !== SourceType.Squad) {
        throw new ForbiddenError(
          'Access denied! You do not have permission for this action!',
        );
      }
      if (source.private && !token) {
        throw new ForbiddenError(
          'Access denied! You do not have permission for this action!',
        );
      }
      const member = await ctx.con
        .getRepository(SourceMember)
        .findOneBy({ referralToken: token });
      if (!member) {
        throw new ForbiddenError(
          'Access denied! You do not have permission for this action!',
        );
      }
      try {
        await ctx.con.transaction(async (entityManager) => {
          await addNewSourceMember(entityManager, {
            sourceId,
            userId: ctx.userId,
            role: SourceMemberRoles.Member,
          });
          await entityManager
            .getRepository(Source)
            .update({ id: sourceId }, { active: true });
        });
      } catch (err) {
        if (err?.code !== TypeOrmError.DUPLICATE_ENTRY) {
          throw err;
        }
      }

      return getSourceById(ctx, info, sourceId);
    },
  }),
  Source: {
    permalink: (source: GQLSource): string => getSourceLink(source),
  },
};
