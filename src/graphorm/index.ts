import { getPermissionsForMember } from './../schema/sources';
import { GraphORM, GraphORMField, QueryBuilder } from './graphorm';
import {
  Bookmark,
  Source,
  User,
  UserPost,
  UserNotification,
  SourceFlagsPublic,
  defaultPublicSourceFlags,
  UserPersonalizedDigestFlagsPublic,
  UserPersonalizedDigestSendType,
  Feature,
  FeatureType,
  SettingsFlagsPublic,
  UserStats,
  UserSubscriptionFlags,
} from '../entity';
import {
  SourceMemberRoles,
  rankToSourceRole,
  sourceRoleRank,
  sourceRoleRankKeys,
} from '../roles';

import { Context } from '../Context';
import { GQLBookmarkList } from '../schema/bookmarks';
import { base64, domainOnly, transformDate } from '../common';
import { GQLComment } from '../schema/comments';
import { GQLUserPost } from '../schema/posts';
import { UserComment } from '../entity/user/UserComment';
import { I18nRecord, UserVote } from '../types';
import { whereVordrFilter } from '../common/vordr';
import { UserCompany } from '../entity/UserCompany';
import { Post } from '../entity/posts/Post';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../entity/contentPreference/types';
import { transformSettingFlags } from '../common/flags';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { ContentPreference } from '../entity/contentPreference/ContentPreference';
import { isPlusMember } from '../paddle';

const existsByUserAndPost =
  (entity: string, build?: (queryBuilder: QueryBuilder) => QueryBuilder) =>
  (ctx: Context, alias: string, qb: QueryBuilder): string => {
    let query = qb
      .select('1')
      .from(entity, 'a')
      .where(`a."userId" = :userId`, { userId: ctx.userId })
      .andWhere(`a."postId" = ${alias}.id`);

    if (typeof build === 'function') {
      query = build(query);
    }

    return `EXISTS${query.getQuery()}`;
  };

const nullIfNotLoggedIn = <T>(value: T, ctx: Context): T | null =>
  ctx.userId ? value : null;

const nullIfNotSameUser = <T>(
  value: T,
  ctx: Context,
  parent: unknown,
): T | null => {
  const user = parent as Pick<User, 'id'>;

  return ctx.userId === user.id ? value : null;
};

const createI18nField = ({
  field,
  fieldAs,
}: {
  field: string;
  fieldAs: string;
}): GraphORMField => {
  return {
    select: field,
    transform: (value: string, ctx: Context, parent): string => {
      const i18nParent = parent as {
        [key: string]: I18nRecord;
      };
      const i18nValue = i18nParent[fieldAs]?.[ctx.contentLanguage];

      if (i18nValue) {
        return i18nValue;
      }

      return value;
    },
  };
};

const obj = new GraphORM({
  User: {
    requiredColumns: ['id', 'username', 'createdAt'],
    fields: {
      infoConfirmed: {
        transform: nullIfNotSameUser,
      },
      email: {
        transform: nullIfNotSameUser,
      },
      timezone: {
        transform: nullIfNotSameUser,
      },
      acceptedMarketing: {
        transform: nullIfNotSameUser,
      },
      notificationEmail: {
        transform: nullIfNotSameUser,
      },
      followingEmail: {
        transform: nullIfNotSameUser,
      },
      followNotifications: {
        transform: nullIfNotSameUser,
      },
      createdAt: {
        transform: transformDate,
      },
      isTeamMember: {
        select: (_, alias, qb) => {
          const query = qb
            .select('1')
            .from(Feature, 'f')
            .where(`f."userId" = ${alias}.id`)
            .andWhere(`f."feature" = :feature`, { feature: FeatureType.Team });

          return `EXISTS${query.getQuery()}`;
        },
        transform: (value: number): boolean => value > 0,
      },
      isPlus: {
        alias: { field: 'subscriptionFlags', type: 'jsonb' },
        transform: (subscriptionFlags: UserSubscriptionFlags) =>
          isPlusMember(subscriptionFlags?.cycle),
      },
      plusMemberSince: {
        alias: { field: 'subscriptionFlags', type: 'jsonb' },
        transform: (subscriptionFlags: UserSubscriptionFlags) =>
          transformDate(subscriptionFlags?.createdAt),
      },
      companies: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .innerJoin(
                UserCompany,
                'uc',
                `"${childAlias}"."id" = uc."companyId"`,
              )
              .where('uc.verified = true')
              .andWhere(`uc."userId" = "${parentAlias}".id`)
              .limit(50),
        },
      },
      contentPreference: {
        relation: {
          isMany: false,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(`${childAlias}."referenceId" = "${parentAlias}".id`)
              .andWhere(
                `${childAlias}."userId" = :currentContentPreferenceUserId`,
                {
                  currentContentPreferenceUserId: ctx.userId,
                },
              )
              .andWhere(`"${childAlias}".type = :type`, {
                type: ContentPreferenceType.User,
              });
          },
        },
        transform: nullIfNotLoggedIn,
      },
      topReader: {
        relation: {
          isMany: false,
          customRelation: (_, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .where(`${childAlias}."userId" = ${parentAlias}.id`)
              .orderBy(`${childAlias}."issuedAt"`, 'DESC')
              .limit(1),
        },
      },
    },
  },
  UserCompany: {
    fields: {
      user: {
        relation: {
          isMany: false,
          childColumn: 'id',
          parentColumn: 'userId',
        },
      },
      company: {
        relation: {
          isMany: false,
          childColumn: 'id',
          parentColumn: 'companyId',
        },
      },
    },
  },
  UserTopReader: {
    fields: {
      keyword: {
        relation: {
          isMany: false,
          childColumn: 'value',
          parentColumn: 'keywordValue',
        },
      },
      user: {
        relation: {
          isMany: false,
          childColumn: 'id',
          parentColumn: 'userId',
        },
      },
      total: {
        select: (_, alias, qb) =>
          qb
            .select('us."topReaderBadges"')
            .from(UserStats, 'us')
            .where(`us."id" = ${alias}."userId"`),
      },
    },
  },
  SourcePostModeration: {
    requiredColumns: ['id'],
  },
  UserStreak: {
    requiredColumns: ['lastViewAt'],
    fields: {
      max: { select: 'maxStreak' },
      total: { select: 'totalStreak' },
      current: { select: 'currentStreak' },
    },
  },
  Post: {
    additionalQuery: (ctx, alias, qb) =>
      qb
        .andWhere(`"${alias}"."deleted" = false`)
        .andWhere(`"${alias}"."visible" = true`),
    requiredColumns: [
      'id',
      'shortId',
      'createdAt',
      'pinnedAt',
      'authorId',
      'scoutId',
      'private',
      'type',
      'slug',
      {
        column: `"contentMeta"->'translate_title'->'translations'`,
        columnAs: 'i18nTitle',
        isJson: true,
      },
    ],
    fields: {
      tags: {
        select: 'tagsStr',
        transform: (value: string): string[] => value?.split(',') ?? [],
      },
      read: {
        select: existsByUserAndPost('View'),
        transform: nullIfNotLoggedIn,
      },
      bookmarked: {
        select: existsByUserAndPost('Bookmark'),
        transform: nullIfNotLoggedIn,
      },
      upvoted: {
        select: existsByUserAndPost('UserPost', (qb) =>
          qb.andWhere(`${qb.alias}.vote = 1`),
        ),
        transform: nullIfNotLoggedIn,
      },
      commented: {
        select: existsByUserAndPost('Comment'),
        transform: nullIfNotLoggedIn,
      },
      views: {
        transform: (value: number, ctx, parent): number | null => {
          const post = parent as Post;

          const isAuthor = post?.authorId && ctx.userId === post.authorId;

          if (isAuthor) {
            return value;
          }

          const isScout = post?.scoutId && ctx.userId === post.scoutId;
          if (isScout) {
            return value;
          }

          return null;
        },
      },
      bookmark: {
        relation: {
          isMany: false,
          customRelation: (
            { userId },
            parentAlias,
            childAlias,
            qb,
          ): QueryBuilder =>
            qb
              .where(`${parentAlias}.id = ${childAlias}."postId"`)
              .andWhere(`${childAlias}."userId" = :userId`, { userId }),
        },
      },
      bookmarkList: {
        relation: {
          isMany: false,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .innerJoin(
                Bookmark,
                'bookmark',
                `${childAlias}.id = bookmark."listId"`,
              )
              .where(`bookmark."postId" = ${parentAlias}.id`)
              .andWhere('bookmark."userId" = :userId', { userId: ctx.userId }),
        },
        transform: (value, ctx): GQLBookmarkList | null =>
          ctx.premium ? value : null,
      },
      numUpvotes: {
        select: 'upvotes',
      },
      numComments: {
        select: 'comments',
      },
      publication: {
        alias: { field: 'source', type: 'Source' },
      },
      toc: {
        jsonType: true,
      },
      sharedPost: {
        relation: {
          isMany: false,
          childColumn: 'id',
          parentColumn: 'sharedPostId',
        },
      },
      downvoted: {
        select: existsByUserAndPost('UserPost', (qb) =>
          qb.andWhere(`${qb.alias}.vote = -1`),
        ),
        transform: nullIfNotLoggedIn,
      },
      flags: {
        jsonType: true,
      },
      userState: {
        relation: {
          isMany: false,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(`${childAlias}."userId" = :voteUserId`, {
                voteUserId: ctx.userId,
              })
              .andWhere(`${childAlias}."postId" = "${parentAlias}".id`);
          },
        },
        transform: (value: GQLUserPost, ctx: Context) => {
          if (!ctx.userId) {
            return null;
          }

          if (!value) {
            return ctx.con.getRepository(UserPost).create();
          }

          return value;
        },
      },
      updatedAt: {
        select: 'metadataChangedAt',
      },
      collectionSources: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(
                `${childAlias}.id = ANY(${parentAlias}."collectionSources")`,
              )
              .limit(3);
          },
        },
      },
      numCollectionSources: {
        select: 'collectionSources',
        transform: (value: string[]): number => value?.length ?? 0,
      },
      domain: {
        alias: { field: 'url', type: 'string' },
        transform: (value: string): string => domainOnly(value),
      },
      title: createI18nField({
        field: 'title',
        fieldAs: 'i18nTitle',
      }),
    },
  },
  SourceCategory: {
    requiredColumns: ['createdAt'],
  },
  Source: {
    requiredColumns: ['id', 'private', 'handle', 'type'],
    fields: {
      flags: {
        jsonType: true,
        transform: (value: SourceFlagsPublic): SourceFlagsPublic => {
          const {
            totalPosts,
            totalViews,
            totalUpvotes,
            totalMembers,
            featured,
          } = defaultPublicSourceFlags;

          return {
            totalPosts: value?.totalPosts ?? totalPosts,
            totalViews: value?.totalViews ?? totalViews,
            totalUpvotes: value?.totalUpvotes ?? totalUpvotes,
            totalMembers: value?.totalMembers ?? totalMembers,
            featured: value?.featured ?? featured,
          };
        },
      },
      public: {
        select: 'private',
        transform: (value: boolean): boolean => !value,
      },
      members: {
        relation: {
          isMany: true,
          order: 'DESC',
          sort: 'createdAt',
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .where(`${childAlias}."referenceId" = "${parentAlias}".id`)
              .andWhere(`${childAlias}.flags->>'role' != :role`, {
                role: SourceMemberRoles.Blocked,
              }),
        },
        pagination: {
          limit: 5,
          hasNextPage: (size): boolean => size === 5,
          hasPreviousPage: (): boolean => false,
          nodeToCursor: (node: GQLComment): string =>
            base64(`time:${new Date(node.createdAt).getTime()}`),
        },
      },
      membersCount: {
        select: 'flags',
        transform: (value: SourceFlagsPublic): number =>
          value?.totalMembers || 0,
      },
      currentMember: {
        relation: {
          isMany: false,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .where(`${childAlias}."userId" = :userId`, { userId: ctx.userId })
              .andWhere(`${childAlias}."referenceId" = "${parentAlias}".id`),
        },
      },
      privilegedMembers: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(`${childAlias}."referenceId" = "${parentAlias}".id`)
              .andWhere(`${childAlias}.flags->>'role' IN (:...roles)`, {
                roles: [SourceMemberRoles.Admin, SourceMemberRoles.Moderator],
              })
              .limit(50); // limit to avoid huge arrays for members, most sources should fit into this see PR !1219 for more info
          },
        },
        transform: nullIfNotLoggedIn,
      },
      memberPostingRole: {
        select: 'memberPostingRank',
        transform: (value: number, ctx: Context) =>
          nullIfNotLoggedIn(rankToSourceRole[value], ctx),
      },
      memberInviteRole: {
        select: 'memberInviteRank',
        transform: (value: number, ctx: Context) =>
          nullIfNotLoggedIn(rankToSourceRole[value], ctx),
      },
    },
  },
  SourceMember: {
    from: 'ContentPreference',
    additionalQuery: (ctx, alias, qb) =>
      qb.andWhere(`"${alias}"."type" = '${ContentPreferenceType.Source}'`),
    requiredColumns: ['createdAt', 'userId', 'flags'],
    fields: {
      permissions: {
        select: (ctx: Context, alias: string, qb: QueryBuilder): string => {
          const query = qb
            .select('array["memberPostingRank", "memberInviteRank"]')
            .from(Source, 'postingSquad')
            .where(`postingSquad.id = ${alias}."referenceId"`);
          return `${query.getQuery()}`;
        },
        transform: (value: [number, number], ctx: Context, parent) => {
          const member = parent as ContentPreferenceSource;

          if (!ctx.userId || member.userId !== ctx.userId) {
            return null;
          }

          const [memberPostingRank, memberInviteRank] = value;

          return getPermissionsForMember(member, {
            memberPostingRank,
            memberInviteRank,
          });
        },
      },
      roleRank: {
        rawSelect: true,
        select: (ctx, alias) => {
          return `
            (CASE
              ${sourceRoleRankKeys
                .map(
                  (role) =>
                    `WHEN ${alias}.flags->>'role' = '${role}' THEN ${sourceRoleRank[role as keyof typeof sourceRoleRank]}`,
                )
                .join(' ')}
            ELSE 0 END)
          `;
        },
      },
      referralToken: {
        rawSelect: true,
        select: (ctx, alias) => {
          return `${alias}.flags->>'referralToken'`;
        },
        transform: (value: string, ctx: Context, parent) => {
          const member = parent as ContentPreferenceSource;

          return nullIfNotSameUser(value, ctx, { id: member.userId });
        },
      },
      role: {
        rawSelect: true,
        select: (ctx, alias) => {
          return `COALESCE(${alias}.flags->>'role', '${SourceMemberRoles.Member}')`;
        },
      },
      flags: {
        jsonType: true,
      },
    },
  },
  Bookmark: {
    from: 'Bookmark',
    fields: {
      remindAt: { transform: transformDate },
      createdAt: { transform: transformDate },
    },
  },
  Comment: {
    requiredColumns: ['id', 'postId', 'createdAt'],
    fields: {
      createdAt: { transform: transformDate },
      lastUpdatedAt: { transform: transformDate },
      upvoted: {
        select: (ctx: Context, alias: string, qb: QueryBuilder): string => {
          const query = qb
            .select('1')
            .from(UserComment, 'cu')
            .where(`cu."userId" = :userId`, { userId: ctx.userId })
            .andWhere(`cu."commentId" = ${alias}.id`)
            .andWhere(`cu."vote" = :vote`, { vote: UserVote.Up });
          return `EXISTS${query.getQuery()}`;
        },
        transform: nullIfNotLoggedIn,
      },
      numUpvotes: {
        select: 'upvotes',
      },
      children: {
        relation: {
          isMany: true,
          childColumn: 'parentId',
          order: 'ASC',
          sort: 'createdAt',
          customRelation(ctx, parentAlias, childAlias, qb) {
            return qb
              .where(`"${childAlias}"."parentId" = "${parentAlias}"."id"`)
              .andWhere(whereVordrFilter(childAlias, ctx.userId));
          },
        },
        pagination: {
          limit: 100,
          hasNextPage: (size): boolean => size === 100,
          hasPreviousPage: (): boolean => false,
          nodeToCursor: (node: GQLComment): string =>
            base64(`time:${new Date(node.createdAt).getTime()}`),
        },
      },
      parent: {
        relation: {
          isMany: false,
          childColumn: 'id',
          parentColumn: 'parentId',
        },
      },
      userState: {
        relation: {
          isMany: false,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(`${childAlias}."userId" = :voteUserId`, {
                voteUserId: ctx.userId,
              })
              .andWhere(`${childAlias}."commentId" = "${parentAlias}".id`);
          },
        },
        transform: (value: GQLComment, ctx: Context) => {
          if (!ctx.userId) {
            return null;
          }

          if (!value) {
            return ctx.con.getRepository(UserComment).create();
          }

          return value;
        },
      },
    },
  },
  FeedSettings: {
    from: 'Feed',
    fields: {
      includeTags: {
        select: (ctx, alias, qb): QueryBuilder =>
          qb
            .select(`string_agg("keywordId", ',' order by "keywordId")`)
            .from(ContentPreference, 'cpk')
            .where(`cpk."feedId" = "${alias}".id`)
            .andWhere('cpk.type = :contentPreferenceType', {
              contentPreferenceType: ContentPreferenceType.Keyword,
            })
            .andWhere('cpk.status != :contentPreferenceStatus', {
              contentPreferenceStatus: ContentPreferenceStatus.Blocked,
            }),
        transform: (value: string): string[] => value?.split(',') ?? [],
      },
      blockedTags: {
        select: (ctx, alias, qb): QueryBuilder =>
          qb
            .select(`string_agg("keywordId", ',' order by "keywordId")`)
            .from(ContentPreference, 'cpk')
            .where(`cpk."feedId" = "${alias}".id`)
            .andWhere('cpk.type = :contentPreferenceType', {
              contentPreferenceType: ContentPreferenceType.Keyword,
            })
            .andWhere('cpk.status = :contentPreferenceStatus', {
              contentPreferenceStatus: ContentPreferenceStatus.Blocked,
            }),
        transform: (value: string): string[] => value?.split(',') ?? [],
      },
      includeSources: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .innerJoin(
                ContentPreferenceSource,
                'cps',
                `"${childAlias}"."id" = cps."referenceId"`,
              )
              .where(`cps."feedId" = "${parentAlias}".id`)
              .andWhere('cps.type = :contentPreferenceSourceType', {
                contentPreferenceSourceType: ContentPreferenceType.Source,
              })
              .andWhere('cps.status != :contentPreferenceSourceStatus', {
                contentPreferenceSourceStatus: ContentPreferenceStatus.Blocked,
              })
              .orderBy(`"${childAlias}".name`),
        },
      },
      excludeSources: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder =>
            qb
              .innerJoin(
                ContentPreferenceSource,
                'cps',
                `"${childAlias}"."id" = cps."referenceId"`,
              )
              .where(`cps."feedId" = "${parentAlias}".id`)
              .andWhere('cps.type = :contentPreferenceSourceType', {
                contentPreferenceSourceType: ContentPreferenceType.Source,
              })
              .andWhere('cps.status = :contentPreferenceSourceStatus', {
                contentPreferenceSourceStatus: ContentPreferenceStatus.Blocked,
              })
              .orderBy(`"${childAlias}".name`),
        },
      },
    },
  },
  FeedAdvancedSettings: {
    fields: {
      id: { alias: { field: 'advancedSettingsId', type: 'int' } },
    },
  },
  ReadingHistory: {
    from: 'ActiveView',
    metadataFrom: 'View',
  },
  Settings: {
    fields: {
      flags: {
        jsonType: true,
        transform: (value: SettingsFlagsPublic): SettingsFlagsPublic => {
          return transformSettingFlags({ flags: value });
        },
      },
    },
  },
  AdvancedSettings: {
    fields: {
      options: {
        jsonType: true,
        transform: async ({ source, ...rest }, ctx) => {
          return {
            ...(source && {
              source: await ctx.getRepository(Source).findOneBy({ id: source }),
            }),
            ...rest,
          };
        },
      },
    },
  },
  Notification: {
    from: 'NotificationV2',
    additionalQuery: (ctx, alias, qb) =>
      qb
        .innerJoin(
          UserNotification,
          'un',
          `"${alias}".id = un."notificationId"`,
        )
        .addSelect('un."readAt"'),
    fields: {
      avatars: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(`"${childAlias}".id = any("${parentAlias}".avatars)`)
              .orderBy(
                `array_position("${parentAlias}".avatars, "${childAlias}".id)`,
              );
          },
        },
      },
      attachments: {
        relation: {
          isMany: true,
          customRelation: (ctx, parentAlias, childAlias, qb): QueryBuilder => {
            return qb
              .where(`"${childAlias}".id = any("${parentAlias}".attachments)`)
              .orderBy(
                `array_position("${parentAlias}".attachments, "${childAlias}".id)`,
              );
          },
        },
      },
    },
  },
  NotificationAttachment: {
    from: 'NotificationAttachmentV2',
  },
  NotificationAvatar: {
    from: 'NotificationAvatarV2',
  },
  UserPost: {
    requiredColumns: ['votedAt'],
    fields: {
      flags: {
        jsonType: true,
      },
    },
  },
  PostQuestion: {
    requiredColumns: ['id'],
  },
  UserPersonalizedDigest: {
    requiredColumns: ['userId'],
    fields: {
      flags: {
        jsonType: true,
        transform: (
          value: UserPersonalizedDigestFlagsPublic,
        ): UserPersonalizedDigestFlagsPublic => {
          return {
            sendType: value?.sendType ?? UserPersonalizedDigestSendType.weekly,
          };
        },
      },
    },
  },
  Keyword: {
    fields: {
      flags: {
        jsonType: true,
        transform: async ({ roadmap, ...rest }) => {
          return {
            ...(roadmap && {
              roadmap: `https://roadmap.sh/${roadmap}?ref=dailydev`,
            }),
            ...rest,
          };
        },
      },
    },
  },
  UserComment: {
    requiredColumns: ['votedAt'],
    fields: {
      flags: {
        jsonType: true,
      },
    },
  },
  Feed: {
    requiredColumns: ['createdAt'],
    fields: {
      flags: {
        jsonType: true,
      },
    },
  },
  UserIntegration: {
    requiredColumns: ['id', 'type', 'meta', 'createdAt'],
    fields: {
      meta: {
        jsonType: true,
      },
      createdAt: {
        transform: transformDate,
      },
      updatedAt: {
        transform: transformDate,
      },
    },
  },
  PostCodeSnippet: {
    requiredColumns: ['order'],
  },
  ContentPreference: {
    requiredColumns: ['createdAt'],
    fields: {
      createdAt: {
        transform: transformDate,
      },
    },
  },
});

export default obj;
