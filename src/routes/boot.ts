import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import createOrGetConnection from '../db';
import { DataSource, Not, QueryRunner } from 'typeorm';
import { clearAuthentication, dispatchWhoami } from '../kratos';
import { generateUUID } from '../ids';
import { generateSessionId, setTrackingId } from '../tracking';
import { GQLUser, getMarketingCta } from '../schema/users';
import {
  Alerts,
  ALERTS_DEFAULT,
  Banner,
  Feature,
  Feed,
  MarketingCta,
  Settings,
  SETTINGS_DEFAULT,
  SourceType,
  SquadSource,
  User,
} from '../entity';
import {
  getPermissionsForMember,
  GQLSource,
  SourcePermissions,
} from '../schema/sources';
import { getAlerts } from '../schema/alerts';
import { getSettings } from '../schema/settings';
import {
  getRedisObject,
  ioRedisPool,
  setRedisObject,
  setRedisObjectWithExpiry,
} from '../redis';
import {
  FEED_SURVEY_INTERVAL,
  generateStorageKey,
  REDIS_BANNER_KEY,
  StorageTopic,
} from '../config';
import {
  ONE_DAY_IN_SECONDS,
  base64,
  getSourceLink,
  submitArticleThreshold,
  mapCloudinaryUrl,
} from '../common';
import { AccessToken, signJwt } from '../auth';
import { cookies, setCookie, setRawCookie } from '../cookies';
import { parse } from 'graphql/language/parser';
import { execute } from 'graphql/execution/execute';
import { schema } from '../graphql';
import { Context } from '../Context';
import { SourceMemberRoles } from '../roles';
import { getEncryptedFeatures } from '../growthbook';
import { differenceInMinutes, isSameDay, subDays } from 'date-fns';
import {
  runInSpan,
  SEMATTRS_DAILY_APPS_USER_ID,
  SEMATTRS_DAILY_STAFF,
} from '../telemetry';
import { getUnreadNotificationsCount } from '../notifications/common';
import { maxFeedsPerUser } from '../types';
import { queryReadReplica } from '../common/queryReadReplica';
import { queryDataSource } from '../common/queryDataSource';
import { isPlusMember } from '../paddle';
import {
  ContentPreferenceSource,
  ContentPreferenceSourceFlags,
} from '../entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../entity/contentPreference/types';

export type BootSquadSource = Omit<GQLSource, 'currentMember'> & {
  permalink: string;
  currentMember: {
    permissions: SourcePermissions[];
  };
};

export type Experimentation = {
  f: string;
  e: string[];
  a: Record<string, unknown>;
};

export type Geo = {
  region?: string;
};

interface ComputedAlerts {
  shouldShowFeedFeedback: boolean;
}

type PublicAlerts = Omit<
  Alerts,
  'userId' | 'flags' | 'user' | 'lastFeedSettingsFeedback'
>;

export type BootAlerts = PublicAlerts & ComputedAlerts;

export type BaseBoot = {
  visit: { visitId: string; sessionId: string };
  alerts: BootAlerts;
  settings: Omit<Settings, 'userId' | 'updatedAt' | 'user'>;
  notifications: { unreadNotificationsCount: number };
  squads: BootSquadSource[];
  exp?: Experimentation;
  geo: Geo;
};

export type BootUserReferral = Partial<{
  referralId?: string;
  referralOrigin?: string;
}>;

interface AnonymousUser extends BootUserReferral {
  id?: string;
  firstVisit: string | null;
  shouldVerify?: boolean;
  email?: string;
}

export type AnonymousBoot = BaseBoot & {
  user: AnonymousUser;
};

export type LoggedInBoot = BaseBoot & {
  user: GQLUser & {
    providers: (string | null)[];
    permalink: string;
    roles: string[];
    canSubmitArticle: boolean;
  };
  accessToken?: AccessToken;
  marketingCta: MarketingCta | null;
};

type BootMiddleware = (
  con: DataSource,
  req: FastifyRequest,
  res: FastifyReply,
) => Promise<Record<string, unknown>>;

const geoSection = (req: FastifyRequest): BaseBoot['geo'] => {
  return {
    region: req.headers['x-client-region'] as string,
  };
};

const visitSection = async (
  req: FastifyRequest,
  res: FastifyReply,
): Promise<BaseBoot['visit']> => {
  const [visitId, sessionId] = await Promise.all([
    generateUUID(),
    generateSessionId(req, res),
  ]);
  return {
    visitId,
    sessionId,
  };
};

export const excludeProperties = <T, K extends keyof T>(
  obj: T,
  properties: K[],
): Pick<T, Exclude<keyof T, K>> => {
  if (!obj) {
    return obj;
  }

  const clone = structuredClone(obj);

  properties.forEach((prop) => {
    delete clone[prop];
  });

  return clone;
};

const getSquads = async (
  con: DataSource | QueryRunner,
  userId: string,
): Promise<BootSquadSource[]> =>
  runInSpan('getSquads', async () => {
    const sources = await con.manager
      .createQueryBuilder()
      .select('id')
      .addSelect('s.type', 'type')
      .addSelect('name')
      .addSelect('handle')
      .addSelect('image')
      .addSelect('NOT private', 'public')
      .addSelect('active')
      .addSelect('cps.flags', 'flags')
      .addSelect('"moderationRequired"')
      .addSelect('"memberPostingRank"')
      .from(ContentPreferenceSource, 'cps')
      .innerJoin(
        SquadSource,
        's',
        'cps."referenceId" = s."id" and s."type" = :sourceType',
        {
          sourceType: SourceType.Squad,
        },
      )
      .where('cps."userId" = :userId', { userId })
      .andWhere(`cps.flags->>'role' != :role`, {
        role: SourceMemberRoles.Blocked,
      })
      .andWhere(`cps.status != :status`, {
        status: ContentPreferenceStatus.Blocked,
      })
      .orderBy('LOWER(s.name)', 'ASC')
      .getRawMany<
        GQLSource & {
          flags: ContentPreferenceSourceFlags;
          memberPostingRank: number;
        }
      >();

    return sources.map((source) => {
      const { flags, memberPostingRank, image, ...restSource } = source;

      const permissions = getPermissionsForMember(
        { flags },
        { memberPostingRank },
      );
      // we only send posting and moderation permissions from boot to keep the payload small
      const essentialPermissions = permissions.filter(
        (item) =>
          item === SourcePermissions.Post ||
          item === SourcePermissions.ModeratePost,
      );
      return {
        ...restSource,
        image: mapCloudinaryUrl(image),
        permalink: getSourceLink(source),
        currentMember: {
          permissions: essentialPermissions,
        },
      };
    });
  });

const getFeeds = async ({
  con,
  userId,
}: {
  con: DataSource | QueryRunner;
  userId: string;
}): Promise<Feed[]> => {
  return con.manager.getRepository(Feed).find({
    where: {
      id: Not(userId),
      userId,
    },
    take: maxFeedsPerUser,
  });
};

const moderators = [
  '1d339aa5b85c4e0ba85fdedb523c48d4',
  '28849d86070e4c099c877ab6837c61f0',
  '5e0af68445e04c02b0656c3530664aff',
  'a491ef61599a4b3e84b6dfa602e6bdfe',
  'f7fed619a1de44fe9a896850422e98ff',
  'pUP1hQ0AOZPBvKlViBnGI',
];

const getRoles = (userId: string): string[] => {
  if (moderators.includes(userId)) {
    return ['moderator'];
  }
  return [];
};

const handleNonExistentUser = async (
  con: DataSource,
  req: FastifyRequest,
  res: FastifyReply,
  middleware?: BootMiddleware,
): Promise<AnonymousBoot> => {
  req.log.info(
    { userId: req.userId },
    'could not find the logged user in the api',
  );
  await clearAuthentication(req, res, 'user not found');
  return anonymousBoot(con, req, res, middleware);
};

const setAuthCookie = async (
  req: FastifyRequest,
  res: FastifyReply,
  userId: string,
  roles: string[],
  isTeamMember: boolean,
): Promise<AccessToken> => {
  const accessToken = await signJwt(
    {
      userId,
      roles,
      isTeamMember,
    },
    15 * 60 * 1000,
  );
  setCookie(req, res, 'auth', accessToken.token);
  return accessToken;
};

const getAndUpdateLastBannerRedis = async (
  con: DataSource | QueryRunner,
): Promise<string | null> => {
  let bannerFromRedis = await getRedisObject(REDIS_BANNER_KEY);

  if (!bannerFromRedis) {
    const banner = await con.manager.getRepository(Banner).findOne({
      select: ['timestamp'],
      where: [],
      order: {
        timestamp: {
          direction: 'DESC',
        },
      },
    });

    if (banner) {
      bannerFromRedis = banner.timestamp.toISOString();
      await setRedisObject(REDIS_BANNER_KEY, bannerFromRedis);
    }
  }

  return bannerFromRedis;
};

export function getReferralFromCookie({
  req,
}: {
  req: FastifyRequest;
}): BootUserReferral | undefined {
  const joinReferralCookie = req.cookies.join_referral;

  if (!joinReferralCookie) {
    return undefined;
  }

  const [referralId, referralOrigin] = joinReferralCookie.split(':');

  if (!referralId || !referralOrigin) {
    return undefined;
  }

  return {
    referralId,
    referralOrigin,
  };
}

const getExperimentation = async ({
  userId,
  con,
  region,
}: {
  userId?: string;
  con: DataSource | QueryRunner;
  region?: string;
}): Promise<Experimentation> => {
  if (userId) {
    const [hash, features] = await Promise.all([
      ioRedisPool.execute((client) => client.hgetall(`exp:${userId}`)),
      con.manager
        .getRepository(Feature)
        .find({ where: { userId }, select: ['feature', 'value'] }),
    ]);
    const e = Object.keys(hash || {}).map((key) => {
      const [variation] = hash[key].split(':');
      return base64(`${key}:${variation}`);
    });
    const a: Experimentation['a'] = features.reduce(
      (acc, { feature, value }) => ({ [feature]: value, ...acc }),
      {},
    );
    if (region) {
      a.region = region;
    }
    return {
      f: getEncryptedFeatures(),
      e,
      a,
    };
  }
  return {
    f: getEncryptedFeatures(),
    e: [],
    a: {},
  };
};

const getUser = (
  con: DataSource | QueryRunner,
  userId: string,
): Promise<User | null> =>
  con.manager.getRepository(User).findOne({
    where: { id: userId },
    select: [
      'id',
      'username',
      'name',
      'email',
      'image',
      'company',
      'title',
      'infoConfirmed',
      'notificationEmail',
      'acceptedMarketing',
      'reputation',
      'bio',
      'twitter',
      'github',
      'portfolio',
      'hashnode',
      'roadmap',
      'threads',
      'codepen',
      'reddit',
      'stackoverflow',
      'youtube',
      'linkedin',
      'mastodon',
      'timezone',
      'createdAt',
      'cover',
      'experienceLevel',
      'language',
      'followingEmail',
      'followNotifications',
      'subscriptionFlags',
    ],
  });

const loggedInBoot = async ({
  con,
  req,
  res,
  refreshToken,
  middleware,
  userId,
}: {
  con: DataSource;
  req: FastifyRequest;
  res: FastifyReply;
  refreshToken: boolean;
  middleware?: BootMiddleware;
  userId: string;
}): Promise<LoggedInBoot | AnonymousBoot> =>
  runInSpan('loggedInBoot', async (span) => {
    span?.setAttribute(SEMATTRS_DAILY_APPS_USER_ID, userId);

    const geo = geoSection(req);

    const { log } = req;
    const [
      visit,
      roles,
      extra,
      [alerts, settings, marketingCta],
      [user, squads, lastBanner, exp, feeds, unreadNotificationsCount],
    ] = await Promise.all([
      visitSection(req, res),
      getRoles(userId),
      middleware ? middleware(con, req, res) : {},
      queryDataSource(con, ({ queryRunner }) => {
        return Promise.all([
          getAlerts(queryRunner, userId),
          getSettings(queryRunner, userId),
          getMarketingCta(queryRunner, log, userId),
        ]);
      }),
      queryReadReplica(con, async ({ queryRunner }) => {
        return Promise.all([
          getUser(queryRunner, userId),
          getSquads(queryRunner, userId),
          getAndUpdateLastBannerRedis(queryRunner),
          getExperimentation({ userId, con: queryRunner, ...geo }),
          getFeeds({ con: queryRunner, userId }),
          getUnreadNotificationsCount(queryRunner, userId),
        ]);
      }),
    ]);
    if (!user) {
      return handleNonExistentUser(con, req, res, middleware);
    }
    const isTeamMember = exp?.a?.team === 1;
    const isPlus = isPlusMember(user.subscriptionFlags?.cycle);

    if (isPlus) {
      exp.a.plus = 1;
    }

    span?.setAttribute(SEMATTRS_DAILY_STAFF, isTeamMember);

    const accessToken = refreshToken
      ? await setAuthCookie(req, res, userId, roles, isTeamMember)
      : req.accessToken;
    return {
      user: {
        ...excludeProperties(user, [
          'updatedAt',
          'referralId',
          'referralOrigin',
          'profileConfirmed',
          'devcardEligible',
          'image',
          'cover',
          'subscriptionFlags',
        ]),
        providers: [null],
        roles,
        permalink: `${process.env.COMMENTS_PREFIX}/${user.username || user.id}`,
        canSubmitArticle: user.reputation >= submitArticleThreshold,
        isTeamMember,
        isPlus,
        language: user.language || undefined,
        image: mapCloudinaryUrl(user.image),
        cover: mapCloudinaryUrl(user.cover),
      },
      visit,
      alerts: {
        ...excludeProperties(alerts, ['userId', 'lastFeedSettingsFeedback']),
        // We decided to try and turn off the changelog for now in favor of squad promotion
        // PR: https://github.com/dailydotdev/daily-api/pull/1633
        changelog: false,
        // read only, used in frontend to decide if banner should be fetched
        banner:
          !!lastBanner &&
          lastBanner !== 'false' &&
          !!alerts.lastBanner &&
          alerts.lastBanner < new Date(lastBanner),
        // read only, used in frontend to decide if boot popup should be shown
        bootPopup: alerts.lastBootPopup
          ? !isSameDay(alerts.lastBootPopup, new Date())
          : true,
        shouldShowFeedFeedback:
          subDays(new Date(), FEED_SURVEY_INTERVAL) >
          alerts.lastFeedSettingsFeedback,
      },
      settings: excludeProperties(settings, [
        'userId',
        'updatedAt',
        'bookmarkSlug',
      ]),
      notifications: { unreadNotificationsCount },
      squads,
      accessToken,
      exp,
      marketingCta,
      feeds,
      geo,
      ...extra,
    };
  });

const getAnonymousFirstVisit = async (trackingId?: string) => {
  if (!trackingId) return null;

  const key = generateStorageKey(StorageTopic.Boot, 'first_visit', trackingId);
  const firstVisit = await getRedisObject(key);
  const finalValue = firstVisit ?? new Date().toISOString();

  await setRedisObjectWithExpiry(key, finalValue, ONE_DAY_IN_SECONDS * 30);

  return finalValue;
};

// We released the firstVisit at July 10, 2023.
// There should have been enough buffer time since we are releasing on July 13, 2023.
export const onboardingV2Requirement = new Date(2023, 6, 13);

const anonymousBoot = async (
  con: DataSource,
  req: FastifyRequest,
  res: FastifyReply,
  middleware?: BootMiddleware,
  shouldVerify = false,
  email?: string,
): Promise<AnonymousBoot> => {
  const geo = geoSection(req);

  const [visit, extra, firstVisit, exp] = await Promise.all([
    visitSection(req, res),
    middleware ? middleware(con, req, res) : {},
    getAnonymousFirstVisit(req.trackingId),
    getExperimentation({ userId: req.trackingId, con, ...geo }),
  ]);

  return {
    user: {
      firstVisit,
      id: req.trackingId,
      ...getReferralFromCookie({ req }),
      ...(shouldVerify && { email }),
      shouldVerify,
    },
    visit,
    alerts: {
      ...excludeProperties(ALERTS_DEFAULT, ['lastFeedSettingsFeedback']),
      changelog: false,
      shouldShowFeedFeedback: false,
    },
    settings: SETTINGS_DEFAULT,
    notifications: { unreadNotificationsCount: 0 },
    squads: [],
    exp,
    geo,
    ...extra,
  };
};

export const getBootData = async (
  con: DataSource,
  req: FastifyRequest,
  res: FastifyReply,
  middleware?: BootMiddleware,
): Promise<AnonymousBoot | LoggedInBoot> => {
  if (
    req.userId &&
    req.accessToken?.expiresIn &&
    differenceInMinutes(req.accessToken?.expiresIn, new Date()) > 3
  ) {
    return loggedInBoot({
      con,
      req,
      res,
      refreshToken: false,
      middleware,
      userId: req.userId,
    });
  }

  const whoami = await dispatchWhoami(req);
  if (whoami.valid) {
    if (whoami.cookie) {
      setRawCookie(res, whoami.cookie);
    }
    if (whoami.verified === false) {
      return anonymousBoot(con, req, res, middleware, true, whoami?.email);
    }
    if (req.userId !== whoami.userId) {
      req.userId = whoami.userId;
      req.trackingId = req.userId;
      setTrackingId(req, res, req.trackingId);
    }
    return loggedInBoot({
      con,
      req,
      res,
      refreshToken: true,
      middleware,
      userId: req.userId,
    });
  } else if (req.cookies[cookies.kratos.key]) {
    await clearAuthentication(req, res, 'invalid cookie');
    return anonymousBoot(con, req, res, middleware);
  }
  return anonymousBoot(con, req, res, middleware);
};

const COMPANION_QUERY = parse(`query Post($url: String) {
        postByUrl(url: $url) {
          id
          title
          image
          permalink
          commentsPermalink
          trending
          summary
          numUpvotes
          upvoted
          numComments
          bookmarked
          createdAt
          readTime
          tags
          source {
            id
            name
            image
          }
          author {
            id
          }
          downvoted
          userState {
            vote
          }
        }
      }`);

export default async function (fastify: FastifyInstance): Promise<void> {
  const con = await createOrGetConnection();

  fastify.get('/', async (req, res) => {
    const data = await getBootData(con, req, res);
    return res.send(data);
  });

  fastify.get('/companion', async (req, res) => {
    const middleware: BootMiddleware = async (con, req) => {
      const res = await execute({
        schema,
        document: COMPANION_QUERY,
        variableValues: {
          url: (req.query as { url?: string }).url,
        },
        contextValue: new Context(req, con),
      });
      if (res?.data?.postByUrl) {
        return { postData: res.data.postByUrl };
      }
      return {};
    };
    const data = await getBootData(con, req, res, middleware);
    return res.send(data);
  });
}
