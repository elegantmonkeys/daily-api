import { getPostCommenterIds } from './post';
import {
  Post,
  User as DbUser,
  UserStreak,
  UserStreakAction,
  UserStreakActionType,
} from '../entity';
import { differenceInDays, isSameDay, max, startOfDay } from 'date-fns';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { CommentMention, Comment, View, Source } from '../entity';
import { getTimezonedStartOfISOWeek, getTimezonedEndOfISOWeek } from './utils';
import { GraphQLResolveInfo } from 'graphql';
import { utcToZonedTime } from 'date-fns-tz';
import { sendAnalyticsEvent } from '../integrations/analytics';
import { DayOfWeek, DEFAULT_TIMEZONE, DEFAULT_WEEK_START } from './date';
import { ChangeObject, ContentLanguage } from '../types';
import { checkRestoreValidity } from './streak';
import { queryReadReplica } from './queryReadReplica';
import { logger } from '../logger';
import type { GQLKeyword } from '../schema/keywords';
import type { GQLUser } from '../schema/users';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../entity/contentPreference/types';

export interface User {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  infoConfirmed: boolean;
  premium?: boolean;
  reputation: number;
  permalink: string;
  username?: string;
  timezone?: string;
  acceptedMarketing?: boolean;
  experienceLevel: string | null;
  language: ContentLanguage | null;
}

export interface GQLUserStreak {
  max?: number;
  total?: number;
  current: number;
  lastViewAt?: Date;
  lastViewAtTz?: Date;
  userId: string;
  weekStart: DayOfWeek;
}

export interface GQLCompany {
  id: string;
  name: string;
  createdAt: Date;
  image: string;
  domains: string[];
}

export interface GQLUserCompany {
  createdAt: Date;
  updatedAt: Date;
  email: string;
}

export interface GQLUserTopReader {
  id: string;
  user: GQLUser;
  issuedAt: Date;
  keyword: GQLKeyword;
  image: string;
}

export interface GQLUserStreakTz extends GQLUserStreak {
  timezone: string;
  lastViewAtTz: Date;
}

export const fetchUser = async (
  userId: string,
  con: DataSource,
): Promise<User | null> => {
  const user = await con.getRepository(DbUser).findOneBy({ id: userId });
  if (!user) {
    return null;
  }
  return user;
};

export const getUserPermalink = (user: Pick<User, 'id' | 'username'>): string =>
  `${process.env.COMMENTS_PREFIX}/${user.username ?? user.id}`;

export const getUserProfileUrl = (username: string): string =>
  `${process.env.COMMENTS_PREFIX}/${username}`;

export interface TagsReadingStatus {
  tag: string;
  readingDays: number;
  percentage: number;
  total: number;
}

export interface ReadingRank {
  rankThisWeek: number;
  rankLastWeek: number;
  currentRank: number;
  progressThisWeek: number;
  readToday: boolean;
  lastReadTime: Date;
  tags: TagsReadingStatus[];
}

interface ReadingRankQueryResult {
  thisWeek: number;
  lastWeek: number;
  today: number;
  lastReadTime: Date;
}

export interface StreakRecoverQueryResult {
  canRecover: boolean;
  cost: number;
  oldStreakLength: number;
}

const V1_STEPS_PER_RANK = [3, 4, 5, 6, 7];
const STEPS_PER_RANK_REVERSE = V1_STEPS_PER_RANK.reverse();

const rankFromProgress = (progress: number) => {
  const reverseRank = STEPS_PER_RANK_REVERSE.findIndex(
    (threshold) => progress >= threshold,
  );
  if (reverseRank > -1) {
    return V1_STEPS_PER_RANK.length - reverseRank;
  }
  return 0;
};

type DateRange = { start: string; end: string };

export interface ReadingDaysArgs {
  userId: string;
  limit?: number;
  dateRange: DateRange;
}

interface RecentMentionsProps {
  query?: string;
  limit: number;
  postId?: string;
  sourceId?: string;
  excludeIds?: string[];
}

export const getRecentMentionsIds = async (
  con: DataSource,
  userId: string,
  { limit = 5, query, excludeIds, sourceId }: RecentMentionsProps,
): Promise<string[]> => {
  let queryBuilder = con
    .getRepository(CommentMention)
    .createQueryBuilder('cm')
    .select('DISTINCT cm."mentionedUserId"')
    .where({ commentByUserId: userId })
    .andWhere({ mentionedUserId: Not(userId) });

  if (sourceId) {
    queryBuilder = queryBuilder
      .innerJoin(
        ContentPreferenceSource,
        'cps',
        'cps."userId" = cm."mentionedUserId"',
      )
      .andWhere('cps."referenceId" = :sourceId', { sourceId })
      .andWhere(`cps.status != :status`, {
        status: ContentPreferenceStatus.Blocked,
      });
  }

  if (query) {
    queryBuilder = queryBuilder
      .select('DISTINCT cm."mentionedUserId", u.name')
      .innerJoin(Comment, 'c', 'cm."commentId" = c.id')
      .innerJoin(DbUser, 'u', 'u.id = cm."mentionedUserId"')
      .andWhere('(u.name ILIKE :name OR u.username ILIKE :name)', {
        name: `${query}%`,
      })
      .orderBy('u.name');
  }

  if (excludeIds?.length) {
    queryBuilder = queryBuilder.andWhere({
      mentionedUserId: Not(In(excludeIds)),
    });
  }

  const result = await queryBuilder.limit(limit).getRawMany<CommentMention>();

  return result.map((user) => user.mentionedUserId);
};

export const getUserIdsByNameOrUsername = async (
  con: DataSource,
  { query, limit = 5, excludeIds, sourceId }: RecentMentionsProps,
): Promise<string[]> => {
  let queryBuilder = con
    .getRepository(DbUser)
    .createQueryBuilder()
    .select('id')
    .where(`(replace(name, ' ', '') ILIKE :name OR username ILIKE :name)`, {
      name: `${query}%`,
    })
    .andWhere('username IS NOT NULL')
    .limit(limit);

  if (sourceId) {
    queryBuilder = queryBuilder
      .innerJoin(ContentPreferenceSource, 'cps', 'id = cps."userId"')
      .andWhere('cps."referenceId" = :sourceId', { sourceId })
      .andWhere(`cps.status != :status`, {
        status: ContentPreferenceStatus.Blocked,
      });
  }

  if (excludeIds?.length) {
    queryBuilder = queryBuilder.andWhere({
      id: Not(In(excludeIds)),
    });
  }

  const result = await queryBuilder.getRawMany<User>();

  return result.map((user) => user.id);
};

export const recommendUsersByQuery = async (
  con: DataSource,
  userId: string,
  { query, limit, sourceId }: RecentMentionsProps,
): Promise<string[]> => {
  const privateSource = sourceId
    ? await queryReadReplica(con, ({ queryRunner }) =>
        queryRunner.manager.getRepository(Source).findOne({
          select: ['id'],
          where: {
            id: sourceId,
            private: true,
          },
        }),
      )
    : undefined;

  const recentIds = await getRecentMentionsIds(con, userId, {
    query,
    limit,
    sourceId: privateSource?.id,
  });
  const missing = limit - recentIds.length;

  if (missing === 0) {
    return recentIds;
  }

  const userIds = await getUserIdsByNameOrUsername(con, {
    limit: missing,
    query,
    sourceId: privateSource?.id,
    excludeIds: recentIds.concat(userId),
  });

  return recentIds.concat(userIds);
};

export const recommendUsersToMention = async (
  con: DataSource,
  userId: string,
  { limit, postId, sourceId }: RecentMentionsProps,
): Promise<string[]> => {
  const ids: string[] = [];

  if (postId) {
    const [post, commenterIds] = await Promise.all([
      con.getRepository(Post).findOneBy({ id: postId, authorId: Not(userId) }),
      getPostCommenterIds(con, postId, { limit, userId }),
    ]);

    if (post?.authorId) {
      commenterIds.unshift(post.authorId);
      if (commenterIds.length > 5) {
        commenterIds.pop();
      }
    }

    ids.push(...commenterIds);
  }

  const missing = limit - ids.length;

  if (missing === 0) {
    return ids;
  }

  const privateSource = sourceId
    ? await con.getRepository(Source).findOneBy({ id: sourceId, private: true })
    : undefined;
  const recent = await getRecentMentionsIds(con, userId, {
    limit: missing,
    excludeIds: ids,
    sourceId: privateSource?.id,
  });

  return ids.concat(recent);
};

export const getUserReadingTags = (
  con: DataSource,
  { userId, dateRange: { start, end }, limit = 8 }: ReadingDaysArgs,
): Promise<TagsReadingStatus[]> => {
  return con.query(
    `--sql
      WITH filtered_view AS (
        SELECT
          v.*,
          CAST(v.timestamp AT TIME ZONE COALESCE(u.timezone,
                                                 'UTC') AS DATE) AS day
        FROM
        "view" v
        JOIN "user" u ON u.id = v."userId"
      WHERE
        u.id = $1
        AND v.timestamp >= $2
        AND v.timestamp < $3
        ),
        distinct_days AS (
      SELECT
        COUNT(DISTINCT day) AS total_days
      FROM
        filtered_view
        ),
        tag_readings AS (
      SELECT
        pk.keyword AS tag,
        COUNT(DISTINCT f.day) AS "readingDays"
      FROM
        filtered_view f
        JOIN post_keyword pk ON f."postId" = pk."postId"
      WHERE
        pk.status = 'allow'
        AND pk.keyword != 'general-programming'
      GROUP BY
        pk.keyword
        )
      SELECT
        tr.tag,
        tr."readingDays",
        tr."readingDays" * 1.0 / dd.total_days AS percentage,
        dd.total_days AS total
      FROM
        tag_readings tr
        CROSS JOIN distinct_days dd
      ORDER BY
        tr."readingDays" DESC
      LIMIT $4;
    `,
    [userId, start, end, limit],
  );
};

export const getUserReadingRank = async (
  con: DataSource,
  userId: string,
  timezone = 'utc',
  version = 1,
  limit = 6,
): Promise<ReadingRank> => {
  if (!timezone) {
    timezone = 'utc';
  }
  const atTimezone = `at time zone '${timezone}'`;
  const req = con
    .createQueryBuilder()
    .select(
      `count(distinct extract(dow from "timestamp"::timestamptz ${atTimezone})) filter(where "timestamp"::timestamptz ${atTimezone} >= date_trunc('week', now())::timestamptz ${atTimezone})`,
      'thisWeek',
    )
    .addSelect(
      `count(distinct extract(dow from "timestamp"::timestamptz ${atTimezone})) filter(where "timestamp"::timestamptz ${atTimezone} BETWEEN (date_trunc('week', now() - interval '7 days')::timestamptz ${atTimezone}) AND (date_trunc('week', now())::timestamptz ${atTimezone}))`,
      'lastWeek',
    )
    .addSelect(`MAX("timestamp"::timestamptz ${atTimezone})`, 'lastReadTime')
    .from(View, 'view')
    .where('"userId" = :id', { id: userId });

  const now = new Date();
  const getReadingTags = () => {
    if (version === 1) {
      return Promise.resolve([]);
    }

    const start = getTimezonedStartOfISOWeek({
      date: now,
      timezone,
    }).toISOString();
    const end = getTimezonedEndOfISOWeek({ date: now, timezone }).toISOString();

    return getUserReadingTags(con, {
      limit,
      userId,
      dateRange: { start, end },
    });
  };

  const [readingStreakResult, tags] = await Promise.all([
    req.getRawOne<ReadingRankQueryResult>(),
    getReadingTags(),
  ]);

  if (!readingStreakResult) {
    throw new Error('failed to get user reading streak');
  }

  const { thisWeek, lastWeek, lastReadTime } = readingStreakResult;
  const rankThisWeek = version === 1 ? rankFromProgress(thisWeek) : thisWeek;
  const rankLastWeek = version === 1 ? rankFromProgress(lastWeek) : lastWeek;
  return {
    lastReadTime,
    currentRank: rankThisWeek > rankLastWeek ? rankThisWeek : rankLastWeek,
    progressThisWeek: thisWeek,
    rankLastWeek,
    rankThisWeek,
    readToday: isSameDay(lastReadTime, now),
    tags,
  };
};

export enum Day {
  Sunday,
  Monday,
  Tuesday,
  Wednesday,
  Thursday,
  Friday,
  Saturday,
}

export const Weekends = [Day.Sunday, Day.Saturday];
export const FREEZE_DAYS_IN_A_WEEK = Weekends.length;
export const MISSED_LIMIT = 1;

/*
 * if last streak was Monday, and today is Wednesday, we should allow recovering streak
 * if last streak was Friday, then the gap is 3 days (the 24-hour period had passed), we should not allow it
 * */
export const STREAK_RECOVERY_MAX_GAP_DAYS = 2;

export const clearUserStreak = async (
  con: DataSource | EntityManager,
  userIds: string[],
): Promise<number> => {
  const events = userIds.map((userId) => ({
    event_timestamp: new Date(),
    event_name: 'streak reset',
    app_platform: 'api',
    user_id: userId,
  }));
  await sendAnalyticsEvent(events);
  const result = await con
    .createQueryBuilder()
    .update(UserStreak)
    .set({ currentStreak: 0, updatedAt: new Date() })
    .where('userId IN (:...userIds)', { userIds })
    .execute();

  return result.affected || 0;
};

// Computes whether we should reset user streak
// Even though it is the weekend, we should still clear the streak for when the user's last read was Thursday
// Due to the fact that when Monday comes, we will clear it anyway when we notice the gap in Friday
export const shouldResetStreak = (
  day: number,
  difference: number,
  startOfWeek: DayOfWeek = DEFAULT_WEEK_START,
) => {
  const firstDayOfWeek =
    startOfWeek === DayOfWeek.Monday ? Day.Monday : Day.Sunday;

  const lastDayOfWeek =
    startOfWeek === DayOfWeek.Monday ? Day.Sunday : Day.Saturday;

  if (day === lastDayOfWeek) {
    return difference > FREEZE_DAYS_IN_A_WEEK;
  }

  if (day === firstDayOfWeek) {
    return difference > FREEZE_DAYS_IN_A_WEEK + MISSED_LIMIT;
  }

  return day > firstDayOfWeek && difference > MISSED_LIMIT;
};

export const checkUserStreak = (
  streak: GQLUserStreakTz,
  lastRecoveredTime?: Date,
): boolean => {
  const { lastViewAtTz: lastViewAt, timezone, current } = streak;
  const lastStreakUpdate = lastRecoveredTime
    ? max([lastViewAt, lastRecoveredTime])
    : lastViewAt;

  if (!lastViewAt || current === 0) {
    return false;
  }

  const today = utcToZonedTime(new Date(), timezone);
  today.setHours(0, 0, 0, 0);

  const day = today.getDay();
  const difference = differenceInDays(today, lastStreakUpdate);

  return shouldResetStreak(day, difference, streak.weekStart);
};

export const getLastStreakRecoverDate = async (
  con: DataSource | EntityManager,
  userId: string,
) => {
  const lastRecoverAction = await con
    .getRepository(UserStreakAction)
    .createQueryBuilder()
    .select(
      `MAX(date_trunc('day', usa."createdAt"::timestamptz at time zone COALESCE(u.timezone, 'utc'))::date - interval '1 day')`,
      'createdAt',
    )
    .from(UserStreakAction, 'usa')
    .innerJoin(DbUser, 'u', 'u.id = usa."userId"')
    .where(`usa."userId" = :userId`, { userId })
    .andWhere(`usa.type = :type`, { type: UserStreakActionType.Recover })
    .getRawOne<UserStreakAction>();

  return lastRecoverAction?.createdAt;
};

export const checkAndClearUserStreak = async (
  con: DataSource | EntityManager,
  info: GraphQLResolveInfo,
  streak: GQLUserStreakTz,
): Promise<boolean> => {
  const lastStreak = await getLastStreakRecoverDate(con, streak.userId);
  const shouldClear = checkUserStreak(streak, lastStreak);

  if (!shouldClear) {
    return false;
  }

  const result = await clearUserStreak(con, [streak.userId]);
  const clearedSuccess = result > 0;

  if (clearedSuccess) {
    logger.info({ streak }, 'Cleared user streak');
  }

  return clearedSuccess;
};

export enum LogoutReason {
  IncomleteOnboarding = 'incomplete onboarding',
  ManualLogout = 'manual logout',
  UserDeleted = 'user deleted',
  KratosSessionAlreadyAvailable = 'kratos session already available',
}

const getAbsoluteDifferenceInDays: typeof differenceInDays = (date1, date2) => {
  const day1 = startOfDay(date1);
  const day2 = startOfDay(date2);

  const timeDiff = Math.abs(day1.getTime() - day2.getTime());
  const diffInDays = timeDiff / (1000 * 60 * 60 * 24);

  // Round down to the nearest whole number since we want full days
  return Math.floor(diffInDays);
};

export const shouldAllowRestore = async (
  con: DataSource,
  streak: ChangeObject<UserStreak>,
  user: DbUser,
) => {
  const { userId, lastViewAt: lastViewAtDb } = streak;
  const timezone = user.timezone || DEFAULT_TIMEZONE;
  const today = utcToZonedTime(new Date(), timezone);
  const lastView = utcToZonedTime(new Date(lastViewAtDb!), timezone);
  const lastRecovery = await getLastStreakRecoverDate(con, userId);
  const lastStreak = lastRecovery ? max([lastView, lastRecovery]) : lastView;
  const lastStreakDifference = getAbsoluteDifferenceInDays(today, lastStreak);

  return checkRestoreValidity({
    day: today.getDay(),
    difference: lastStreakDifference,
    startOfWeek: user.weekStart,
    lastView: lastStreak,
  });
};

export const roadmapShSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?roadmap\.sh\/u\/)?(?<value>[\w-]{2,})\/?$/;

export const twitterSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?(?:twitter|x)\.com\/)?@?(?<value>[\w-]{2,})\/?$/;

export const githubSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?github\.com\/)?@?(?<value>[\w-]{2,})\/?$/;

export const threadsSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?threads\.net\/)?@?(?<value>[\w-]{2,})\/?$/;

export const codepenSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?codepen\.io\/)?(?<value>[\w-]{2,})\/?$/;

export const redditSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?reddit\.com\/(?:u|user)\/)?(?<value>[\w-]{2,})\/?$/;

export const stackoverflowSocialUrlMatch =
  /^(?:https:\/\/)?(?:www\.)?stackoverflow\.com\/users\/(?<value>\d{2,}\/?[\w-]{2,}?)\/?$/;

export const youtubeSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?youtube\.com\/)?@?(?<value>[\w-]{2,})\/?$/;

export const linkedinSocialUrlMatch =
  /^(?:(?:https:\/\/)?(?:www\.)?linkedin\.com\/in\/)?(?<value>[\w-]{2,})\/?$/;

export const mastodonSocialUrlMatch =
  /^(?<value>https:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]+\.[a-z]{2,}\/@[\w-]{2,}\/?)$/;

export const socialUrlMatch =
  /^(?<value>https:\/\/(?:[a-z0-9-]{1,50}\.){0,5}[a-z0-9-]{1,50}\.[a-z]{2,24}\b([-a-zA-Z0-9@:%_+.~#?&\/=]*))$/;

export const portfolioLimit = 500;
