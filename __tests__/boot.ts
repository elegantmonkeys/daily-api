import { FastifyInstance } from 'fastify';
import request from 'supertest';
import {
  GraphQLTestingState,
  initializeGraphQLTesting,
  MockContext,
  saveFixtures,
  TEST_UA,
} from './helpers';
import createOrGetConnection from '../src/db';
import { DataSource } from 'typeorm';
import {
  Alerts,
  ALERTS_DEFAULT,
  ArticlePost,
  Banner,
  Feature,
  FeatureType,
  Feed,
  MachineSource,
  MarketingCta,
  MarketingCtaStatus,
  NotificationV2,
  Post,
  Settings,
  SETTINGS_DEFAULT,
  Source,
  SourceType,
  SQUAD_IMAGE_PLACEHOLDER,
  SquadSource,
  User,
  UserMarketingCta,
  UserNotification,
} from '../src/entity';
import { SourceMemberRoles, sourceRoleRank } from '../src/roles';
import { notificationV2Fixture } from './fixture/notifications';
import { usersFixture } from './fixture/user';
import {
  getRedisObject,
  ioRedisPool,
  RedisMagicValues,
  setRedisObject,
} from '../src/redis';
import {
  FEED_SURVEY_INTERVAL,
  generateStorageKey,
  REDIS_BANNER_KEY,
  StorageKey,
  StorageTopic,
} from '../src/config';
import nock from 'nock';
import { addDays, setMilliseconds, subDays } from 'date-fns';
import setCookieParser from 'set-cookie-parser';
import { postsFixture } from './fixture/post';
import { sourcesFixture } from './fixture/source';
import { SourcePermissions } from '../src/schema/sources';
import { getEncryptedFeatures } from '../src/growthbook';
import { base64 } from 'graphql-relay/utils/base64';
import { cookies } from '../src/cookies';
import { signJwt } from '../src/auth';
import { DEFAULT_TIMEZONE, submitArticleThreshold } from '../src/common';
import { saveReturnAlerts } from '../src/schema/alerts';
import { UserVote } from '../src/types';
import { BootAlerts, excludeProperties } from '../src/routes/boot';
import { ContentPreferenceSource } from '../src/entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../src/entity/contentPreference/types';

let app: FastifyInstance;
let con: DataSource;
let state: GraphQLTestingState;

const BASE_BODY = {
  alerts: {
    ...excludeProperties(ALERTS_DEFAULT, ['lastFeedSettingsFeedback']),
    lastChangelog: expect.any(String),
    lastBanner: expect.any(String),
    shouldShowFeedFeedback: false,
  },
  settings: { ...SETTINGS_DEFAULT },
  notifications: { unreadNotificationsCount: 0 },
  squads: [],
  visit: {
    sessionId: expect.any(String),
    visitId: expect.any(String),
  },
  exp: { f: 'enc', e: [], a: {} },
  geo: {},
};

const LOGGED_IN_BODY = {
  ...BASE_BODY,
  alerts: {
    ...BASE_BODY.alerts,
    bootPopup: true,
  },
  accessToken: {
    expiresIn: expect.any(String),
    token: expect.any(String),
  },
  user: {
    ...usersFixture[0],
    createdAt: (usersFixture[0].createdAt as Date).toISOString(),
    permalink: 'http://localhost:5002/idoshamun',
    providers: [null],
    roles: [],
    title: null,
    timezone: DEFAULT_TIMEZONE,
    reputation: 10,
    portfolio: null,
    notificationEmail: true,
    acceptedMarketing: false,
    company: null,
    experienceLevel: null,
    followNotifications: true,
    followingEmail: true,
    isTeamMember: false,
    roadmap: null,
    threads: null,
    codepen: null,
    reddit: null,
    stackoverflow: null,
    youtube: null,
    linkedin: null,
    mastodon: null,
    language: undefined,
    isPlus: false,
  },
  marketingCta: null,
  feeds: [],
};

const ANONYMOUS_BODY = {
  ...BASE_BODY,
  settings: SETTINGS_DEFAULT,
  user: {
    id: expect.any(String),
    firstVisit: expect.any(String),
    shouldVerify: false,
  },
};

const getBootAlert = (data: Alerts): BootAlerts =>
  new Object({
    ...excludeProperties(saveReturnAlerts(data), [
      'userId',
      'lastFeedSettingsFeedback',
    ]),
    shouldShowFeedFeedback:
      subDays(new Date(), FEED_SURVEY_INTERVAL) > data.lastFeedSettingsFeedback,
  }) as BootAlerts;

beforeAll(async () => {
  con = await createOrGetConnection();
  state = await initializeGraphQLTesting(() => new MockContext(con));
  app = state.app;
});

beforeEach(async () => {
  const users = usersFixture.slice(0, 1);

  jest.resetAllMocks();
  jest.mocked(getEncryptedFeatures).mockReturnValue('enc');
  await con.getRepository(User).save(users);
  await con.getRepository(Source).save(sourcesFixture);
  await con.getRepository(Post).save(postsFixture);
  await ioRedisPool.execute((client) => client.flushall());
  await saveFixtures(
    con,
    Feed,
    users.map((u) => ({ id: u.id, userId: u.id })),
  );
});

const BASE_PATH = '/boot';
const KRATOS_EXPIRATION = addDays(setMilliseconds(new Date(), 0), 1);

const mockWhoami = (expected: unknown, statusCode = 200) => {
  nock(process.env.HEIMDALL_ORIGIN)
    .get('/api/whoami')
    .reply(statusCode, JSON.stringify(expected), {
      'set-cookie': `ory_kratos_session=new_value; Path=/; Expires=${KRATOS_EXPIRATION.toUTCString()}; Max-Age=86399; HttpOnly; SameSite=Lax`,
    });
};

const mockLoggedIn = (userId = '1') =>
  mockWhoami({
    session: {
      identity: { traits: { userId } },
      expires_at: KRATOS_EXPIRATION,
    },
    verified: true,
  });

const mockLegacyLoggedIn = (userId = '1') =>
  mockWhoami({
    identity: { traits: { userId } },
    expires_at: KRATOS_EXPIRATION,
  });

describe('anonymous boot', () => {
  it('should return defaults', async () => {
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(res.body).toEqual(ANONYMOUS_BODY);
  });

  it('should keep the same tracking and session id', async () => {
    const first = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);
    const second = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', first.headers['set-cookie'])
      .expect(200);
    expect(second.body.user.id).toEqual(first.body.user.id);
    expect(second.body.visit.sessionId).toEqual(first.body.visit.sessionId);
  });

  it('should not set tracking and session id for bots', async () => {
    const res = await request(app.server).get(BASE_PATH).expect(200);
    expect(res.body).toEqual({
      ...ANONYMOUS_BODY,
      user: {
        firstVisit: null,
        shouldVerify: false,
      },
      visit: {
        visitId: expect.any(String),
      },
    });
  });

  it('should read join_referral cookie', async () => {
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', ['join_referral=1:knightcampaign'])
      .expect(200);
    expect(res.body).toEqual({
      ...ANONYMOUS_BODY,
      user: {
        firstVisit: null,
        referralId: '1',
        referralOrigin: 'knightcampaign',
        shouldVerify: false,
      },
      visit: {
        visitId: expect.any(String),
      },
    });
  });

  it('should set first visit value if null', async () => {
    const first = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(first.body.user.firstVisit).toBeTruthy();
    await ioRedisPool.execute((client) => client.flushall());
    const second = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', first.headers['set-cookie'])
      .expect(200);
    expect(second.body.user.id).toEqual(first.body.user.id);
    expect(second.body.user.firstVisit).toBeTruthy();
    expect(second.body.user.firstVisit).not.toEqual(first.body.user.firstVisit);
  });

  it('should retain first visit value if not null', async () => {
    const first = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(first.body.user.firstVisit).toBeTruthy();
    const second = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', first.headers['set-cookie'])
      .expect(200);
    expect(second.body.user.id).toEqual(first.body.user.id);
    expect(second.body.user.firstVisit).toBeTruthy();
    expect(second.body.user.firstVisit).toEqual(first.body.user.firstVisit);
  });

  it('should extend the TTL for redis cache if user visits a second time', async () => {
    const first = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);

    const key = generateStorageKey(
      StorageTopic.Boot,
      'first_visit',
      first.body.user.id,
    );

    const firstTTL = await ioRedisPool.execute((client) => client.ttl(key));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', first.headers['set-cookie'])
      .expect(200);
    const secondTTL = await ioRedisPool.execute((client) => client.ttl(key));
    // Should have reset the TTL
    expect(firstTTL).toEqual(secondTTL);
  });

  it('should return anonymous boot if jwt is expired', async () => {
    const accessToken = await signJwt(
      {
        userId: '1',
        roles: [],
      },
      -15 * 60 * 1000,
    );
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set(
        'Cookie',
        `${cookies.auth.key}=${app.signCookie(accessToken.token)};`,
      )
      .expect(200);
    expect(res.body).toEqual(ANONYMOUS_BODY);
  });
});

describe('logged in boot', () => {
  it('should boot data when no access token cookie but whoami succeeds', async () => {
    mockLoggedIn();
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body).toEqual({
      ...LOGGED_IN_BODY,
      user: {
        ...LOGGED_IN_BODY.user,
        canSubmitArticle:
          LOGGED_IN_BODY.user.reputation >= submitArticleThreshold,
      },
    });
  });

  it('should boot data when legacy kratos whoami is returned', async () => {
    mockLegacyLoggedIn();
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body).toEqual({
      ...LOGGED_IN_BODY,
      user: {
        ...LOGGED_IN_BODY.user,
        canSubmitArticle:
          LOGGED_IN_BODY.user.reputation >= submitArticleThreshold,
      },
    });
  });

  it('should set kratos cookie expiration', async () => {
    mockLoggedIn();
    const kratosCookie = 'ory_kratos_session';
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', `${kratosCookie}=value;`)
      .expect(200);
    const cookies = setCookieParser.parse(res, { map: true });
    expect(cookies[kratosCookie].value).toEqual('new_value');
    expect(cookies[kratosCookie].expires).toEqual(KRATOS_EXPIRATION);
  });

  it('should set tracking id according to user id', async () => {
    mockLoggedIn();
    const trackingCookie = 'da2';
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', `ory_kratos_session=value;${trackingCookie}=t;`)
      .expect(200);
    const cookies = setCookieParser.parse(res, { map: true });
    expect(cookies[trackingCookie].value).toEqual('1');
  });

  it('should handle 401 from auth server', async () => {
    mockWhoami({}, 401);
    const trackingCookie = 'da2';
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    const cookies = setCookieParser.parse(res, { map: true });
    expect(cookies[trackingCookie].value).toBeTruthy();
    expect(cookies[trackingCookie].value).not.toEqual('1');
    expect(res.body).toEqual({
      ...ANONYMOUS_BODY,
    });
  });

  it('should handle user does not exist', async () => {
    mockLoggedIn('2');
    const trackingCookie = 'da2';
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    const cookies = setCookieParser.parse(res, { map: true });
    expect(cookies[trackingCookie].value).toBeTruthy();
    expect(cookies[trackingCookie].value).not.toEqual('2');
    expect(res.body).toEqual({
      ...ANONYMOUS_BODY,
    });
  });

  it('should not dispatch whoami when jwt is available', async () => {
    const accessToken = await signJwt(
      {
        userId: '1',
        roles: [],
      },
      15 * 60 * 1000,
    );
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set(
        'Cookie',
        `${cookies.auth.key}=${app.signCookie(accessToken.token)};`,
      )
      .expect(200);
    expect(res.body).toEqual({
      ...LOGGED_IN_BODY,
      user: {
        ...LOGGED_IN_BODY.user,
        canSubmitArticle:
          LOGGED_IN_BODY.user.reputation >= submitArticleThreshold,
      },
    });
  });

  it('should set team member to true if user is a team member', async () => {
    await con.getRepository(Feature).save({
      feature: FeatureType.Team,
      userId: '1',
      value: 1,
    });
    mockLoggedIn();
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.user.isTeamMember).toEqual(true);
  });
});

describe('boot marketing cta', () => {
  it('should not return marketing cta for anonymous user', async () => {
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);

    expect(res.body).not.toHaveProperty('marketingCta');
  });

  it('should return null if the user has no marketing cta', async () => {
    const userId = '1';
    mockLoggedIn(userId);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);

    expect(res.body.marketingCta).toBeNull();
    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toEqual(RedisMagicValues.SLEEPING);
  });

  it('should not check the database if redis value is set to sleeping', async () => {
    const userId = '1';
    mockLoggedIn(userId);
    await setRedisObject(
      generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      RedisMagicValues.SLEEPING,
    );

    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toEqual(RedisMagicValues.SLEEPING);

    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);

    expect(res.body.marketingCta).toBeNull();
    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toEqual(RedisMagicValues.SLEEPING);
  });

  it('should return null if user has no marketing cta on future ', async () => {
    const userId = '1';
    mockLoggedIn(userId);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);

    expect(res.body.marketingCta).toBeNull();
    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toEqual(RedisMagicValues.SLEEPING);
  });

  it('should return marketing cta for user', async () => {
    const userId = '1';
    mockLoggedIn(userId);

    await con.getRepository(MarketingCta).save({
      campaignId: 'worlds-best-campaign',
      variant: 'card',
      createdAt: new Date('2024-03-13 12:00:00'),
      flags: {
        title: 'Join the best community in the world',
        description: 'Join the best community in the world',
        ctaUrl: 'http://localhost:5002',
        ctaText: 'Join now',
      },
    });
    await con.getRepository(UserMarketingCta).save({
      marketingCtaId: 'worlds-best-campaign',
      userId,
      createdAt: new Date('2024-03-13 12:00:00'),
    });

    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toBeNull();

    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);

    expect(res.body.marketingCta).toMatchObject({
      campaignId: 'worlds-best-campaign',
      variant: 'card',
      createdAt: '2024-03-13T12:00:00.000Z',
      flags: {
        title: 'Join the best community in the world',
        description: 'Join the best community in the world',
        ctaUrl: 'http://localhost:5002',
        ctaText: 'Join now',
      },
    });

    expect(res.body.marketingCta).toMatchObject(
      JSON.parse(
        (await getRedisObject(
          generateStorageKey(
            StorageTopic.Boot,
            StorageKey.MarketingCta,
            userId,
          ),
        )) as string,
      ),
    );
  });

  it('should not return marketing cta for user if campaign is not active', async () => {
    const userId = '1';
    mockLoggedIn(userId);

    await con.getRepository(MarketingCta).save({
      campaignId: 'worlds-best-campaign',
      variant: 'card',
      status: MarketingCtaStatus.Paused,
      createdAt: new Date('2024-03-13 12:00:00'),
      flags: {
        title: 'Join the best community in the world',
        description: 'Join the best community in the world',
        ctaUrl: 'http://localhost:5002',
        ctaText: 'Join now',
      },
    });
    await con.getRepository(UserMarketingCta).save({
      marketingCtaId: 'worlds-best-campaign',
      userId,
      createdAt: new Date('2024-03-13 12:00:00'),
    });

    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toBeNull();

    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);

    expect(res.body.marketingCta).toBeNull();

    expect(
      await getRedisObject(
        generateStorageKey(StorageTopic.Boot, StorageKey.MarketingCta, userId),
      ),
    ).toEqual(RedisMagicValues.SLEEPING);
  });
});

describe('boot alerts', () => {
  it('should return user alerts', async () => {
    mockLoggedIn();
    const data = await con.getRepository(Alerts).save({
      ...ALERTS_DEFAULT,
      userId: '1',
      myFeed: 'created',
    });

    const alerts = getBootAlert(data);
    alerts['changelog'] = false;
    alerts['banner'] = false;
    alerts['bootPopup'] = true;
    delete alerts['userId'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts).toEqual({
      ...alerts,
      lastBanner: expect.any(String),
      lastChangelog: expect.any(String),
    });
  });

  it('should return banner as true', async () => {
    mockLoggedIn();
    await setRedisObject(REDIS_BANNER_KEY, '2023-02-06 12:00:00');
    const data = await con.getRepository(Alerts).save({
      ...ALERTS_DEFAULT,
      userId: '1',
      myFeed: 'created',
      lastBanner: new Date('2023-02-05 12:00:00'),
      lastChangelog: new Date('2023-02-05 12:00:00'),
    });
    const alerts = getBootAlert(data);
    alerts['shouldShowFeedFeedback'] = false;
    alerts['changelog'] = false;
    alerts['banner'] = true;
    alerts['bootPopup'] = true;
    delete alerts['userId'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts).toEqual(alerts);
  });

  it('should return banner as false', async () => {
    mockLoggedIn();
    await setRedisObject(REDIS_BANNER_KEY, '2023-02-05 12:00:00');
    const data = await con.getRepository(Alerts).save({
      ...ALERTS_DEFAULT,
      userId: '1',
      myFeed: 'created',
      lastBanner: new Date('2023-02-06 12:00:00'),
      lastChangelog: new Date('2023-02-06 12:00:00'),
    });
    const alerts = getBootAlert(data);
    alerts['banner'] = false;
    alerts['changelog'] = false;
    alerts['bootPopup'] = true;
    delete alerts['userId'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts).toEqual(alerts);
  });

  it('should return banner as false if redis is false', async () => {
    mockLoggedIn();
    const data = await con.getRepository(Alerts).save({
      ...ALERTS_DEFAULT,
      userId: '1',
      myFeed: 'created',
      lastChangelog: new Date('2023-02-05 12:00:00'),
      lastBanner: new Date('2023-02-05 12:00:00'),
    });
    const alerts = getBootAlert(data);
    alerts['shouldShowFeedFeedback'] = false;
    alerts['changelog'] = false;
    alerts['banner'] = false;
    alerts['bootPopup'] = true;
    delete alerts['userId'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts).toEqual(alerts);
  });

  it('should return banner as true if redis is empty', async () => {
    mockLoggedIn();
    const data = await con.getRepository(Alerts).save({
      ...ALERTS_DEFAULT,
      userId: '1',
      myFeed: 'created',
      lastChangelog: new Date('2023-02-05 12:00:00'),
      lastBanner: new Date('2023-02-06 12:00:00'),
    });
    const banner = await con.getRepository(Banner).save({
      timestamp: '2023-02-08T12:00:00.000Z',
      title: 'test',
      subtitle: 'test',
      cta: 'test',
      url: 'test',
      theme: 'cabbage',
    });
    const alerts = getBootAlert(data);
    alerts['banner'] = true;
    alerts['changelog'] = false;
    alerts['shouldShowFeedFeedback'] = false;
    alerts['bootPopup'] = true;
    delete alerts['userId'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts).toEqual(alerts);
    expect(await getRedisObject(REDIS_BANNER_KEY)).toEqual(
      banner.timestamp.toISOString(),
    );
  });

  it('should return showGenericReferral as true', async () => {
    mockLoggedIn();
    const data = await con.getRepository(Alerts).save({
      ...ALERTS_DEFAULT,
      userId: '1',
      myFeed: 'created',
      lastChangelog: new Date('2023-02-05 12:00:00'),
      lastBanner: new Date('2023-02-05 12:00:00'),
      banner: false,
      changelog: false,
      showGenericReferral: true,
    });
    const alerts = getBootAlert(data);
    alerts['shouldShowFeedFeedback'] = false;
    alerts['bootPopup'] = true;
    delete alerts['userId'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts).toEqual(alerts);
  });
});

describe('boot misc', () => {
  it('should return user settings', async () => {
    mockLoggedIn();
    const data = await con.getRepository(Settings).save({
      userId: '1',
      theme: 'bright',
      insaneMode: true,
    });
    const settings = new Object(data);
    delete settings['updatedAt'];
    delete settings['userId'];
    delete settings['bookmarkSlug'];
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.settings).toEqual({
      ...settings,
      flags: {
        sidebarCustomFeedsExpanded: true,
        sidebarOtherExpanded: true,
        sidebarResourcesExpanded: true,
        sidebarSquadExpanded: true,
        sidebarBookmarksExpanded: true,
      },
    });
  });

  it('should return unread notifications count', async () => {
    mockLoggedIn();
    const notifs = await con.getRepository(NotificationV2).save([
      notificationV2Fixture,
      {
        ...notificationV2Fixture,
        uniqueKey: '2',
      },
      {
        ...notificationV2Fixture,
        uniqueKey: '3',
      },
    ]);
    await con.getRepository(UserNotification).insert([
      {
        userId: '1',
        notificationId: notifs[0].id,
        createdAt: notificationV2Fixture.createdAt,
      },
      {
        userId: '1',
        notificationId: notifs[1].id,
      },
      {
        userId: '1',
        notificationId: notifs[2].id,
        readAt: new Date(),
      },
    ]);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.notifications).toEqual({ unreadNotificationsCount: 2 });
  });

  it('should return the user squads', async () => {
    mockLoggedIn();
    await con.getRepository(SquadSource).save([
      {
        id: 's1',
        handle: 's1',
        name: 'Squad',
        private: false,
        active: false,
      },
      {
        id: 's2',
        handle: 's2',
        name: 'Squad 2',
        private: true,
        active: true,
      },
      {
        id: 's3',
        handle: 's3',
        name: 'Squad 3',
        private: true,
        active: true,
      },
      {
        id: 's5',
        handle: 's5',
        name: 'Squad 5',
        private: true,
        active: true,
        memberPostingRank: sourceRoleRank[SourceMemberRoles.Moderator],
      },
    ]);
    await con.getRepository(MachineSource).save([
      {
        id: 's4',
        handle: 's4',
        name: 'Source',
        private: false,
        active: false,
      },
    ]);
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 's1',
        referenceId: 's1',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 's2',
        referenceId: 's2',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 's4',
        referenceId: 's4',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt3',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 's5',
        referenceId: 's5',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt5',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.squads).toEqual([
      {
        active: false,
        handle: 's1',
        id: 's1',
        image: SQUAD_IMAGE_PLACEHOLDER,
        moderationRequired: false,
        name: 'Squad',
        permalink: 'http://localhost:5002/squads/s1',
        public: true,
        type: SourceType.Squad,
        currentMember: {
          permissions: [SourcePermissions.Post],
        },
      },
      {
        active: true,
        handle: 's2',
        id: 's2',
        image: SQUAD_IMAGE_PLACEHOLDER,
        moderationRequired: false,
        name: 'Squad 2',
        permalink: 'http://localhost:5002/squads/s2',
        public: false,
        type: SourceType.Squad,
        currentMember: {
          permissions: [SourcePermissions.Post],
        },
      },
      {
        active: true,
        handle: 's5',
        id: 's5',
        image: SQUAD_IMAGE_PLACEHOLDER,
        moderationRequired: false,
        name: 'Squad 5',
        permalink: 'http://localhost:5002/squads/s5',
        public: false,
        type: SourceType.Squad,
        currentMember: {
          permissions: [],
        },
      },
    ]);
  });

  it('should not return squads users blocked from', async () => {
    mockLoggedIn();
    await con.getRepository(SquadSource).save([
      {
        id: 's1',
        handle: 's1',
        name: 'Squad',
        private: false,
        active: false,
      },
      {
        id: 's3',
        handle: 's3',
        name: 'Squad 3',
        private: true,
        active: true,
      },
    ]);
    await con.getRepository(MachineSource).save([
      {
        id: 's4',
        handle: 's4',
        name: 'Source',
        private: false,
        active: false,
      },
    ]);
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 's1',
        referenceId: 's1',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Member,
          referralToken: 'rt',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 's3',
        referenceId: 's3',
        userId: '1',
        flags: {
          role: SourceMemberRoles.Blocked,
          referralToken: 'rt3',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
    ]);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.squads).toEqual([
      {
        active: false,
        handle: 's1',
        id: 's1',
        image: SQUAD_IMAGE_PLACEHOLDER,
        moderationRequired: false,
        name: 'Squad',
        permalink: 'http://localhost:5002/squads/s1',
        public: true,
        type: SourceType.Squad,
        currentMember: {
          permissions: [SourcePermissions.Post],
        },
      },
    ]);
  });

  it('should return the user feeds', async () => {
    mockLoggedIn();
    const feeds = [
      {
        id: '1',
        userId: '1',

        slug: '1',
      },
      {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
        slug: 'cool-feed-cf1',
      },
      {
        id: 'cf2',
        userId: '1',
        flags: {
          name: 'PHP feed',
        },
        slug: 'php-feed-cf2',
      },
      {
        id: 'cf3',
        userId: '2',
        flags: {
          name: 'Awful feed',
        },
        slug: 'awful-feed-cf3',
      },
    ];
    await saveFixtures(con, User, usersFixture);
    await con.getRepository(Feed).save(feeds);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.feeds).toMatchObject([
      {
        id: 'cf1',
        userId: '1',
        flags: {
          name: 'Cool feed',
        },
        slug: 'cool-feed-cf1',
      },
      {
        id: 'cf2',
        userId: '1',
        flags: {
          name: 'PHP feed',
        },
        slug: 'php-feed-cf2',
      },
    ]);
  });
});

describe('boot experimentation', () => {
  it('should return recent experiments from redis', async () => {
    mockLoggedIn();
    await ioRedisPool.execute((client) =>
      client.hset('exp:1', {
        e1: `v1:${new Date(2023, 5, 20).getTime()}`,
        e2: `v2:${new Date(2023, 5, 19).getTime()}`,
      }),
    );
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.exp.e).toEqual([base64('e1:v1'), base64('e2:v2')]);
  });

  it('should return features as attributes', async () => {
    mockLoggedIn();
    await con.getRepository(Feature).save([
      {
        userId: '1',
        feature: FeatureType.Search,
      },
      {
        userId: '1',
        feature: FeatureType.Squad,
      },
    ]);
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.exp.a).toEqual({ search: 1, squad: 1 });
  });
});

describe('companion boot', () => {
  const POST_DATA = {
    author: null,
    bookmarked: null,
    commentsPermalink: 'http://localhost:5002/posts/p1-p1',
    createdAt: expect.any(String),
    id: 'p1',
    image: 'https://daily.dev/image.jpg',
    numComments: 0,
    numUpvotes: 0,
    permalink: 'http://localhost:4000/r/sp1',
    readTime: null,
    source: {
      id: 'a',
      image: 'http://image.com/a',
      name: 'A',
    },
    summary: null,
    tags: ['javascript', 'webdev'],
    title: 'P1',
    trending: null,
    upvoted: null,
    downvoted: null,
    userState: null,
  };

  it('should support anonymous user', async () => {
    const res = await request(app.server)
      .get(`${BASE_PATH}/companion`)
      .query({ url: (postsFixture[0] as ArticlePost).url })
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(res.body).toEqual({
      ...ANONYMOUS_BODY,
      postData: POST_DATA,
    });
  });

  it('should support logged user', async () => {
    mockLoggedIn();
    const res = await request(app.server)
      .get(`${BASE_PATH}/companion`)
      .query({ url: (postsFixture[0] as ArticlePost).url })
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body).toEqual({
      ...LOGGED_IN_BODY,
      postData: {
        ...POST_DATA,
        bookmarked: false,
        upvoted: false,
        downvoted: false,
        userState: {
          vote: UserVote.None,
        },
      },
      user: {
        ...LOGGED_IN_BODY.user,
        canSubmitArticle:
          LOGGED_IN_BODY.user.reputation >= submitArticleThreshold,
      },
    });
  });

  it('should handle url not found', async () => {
    const res = await request(app.server)
      .get(`${BASE_PATH}/companion`)
      .query({ url: 'notfound' })
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(res.body).toEqual(ANONYMOUS_BODY);
  });

  it('should handle url not found', async () => {
    const res = await request(app.server)
      .get(`${BASE_PATH}/companion`)
      .query({ url: 'notfound' })
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(res.body).toEqual(ANONYMOUS_BODY);
  });
});

describe('boot alerts shouldShowFeedFeedback property', () => {
  it('should be false when the user has no alerts', async () => {
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .expect(200);
    expect(res.body.alerts.shouldShowFeedFeedback).toBeFalsy();
  });

  it('should be false when the user has seen the survey few days ago', async () => {
    mockLoggedIn();
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts.shouldShowFeedFeedback).toBeFalsy();
  });

  it('should be true when the user has has seen the survey more than 30 days ago', async () => {
    await con
      .getRepository(Alerts)
      .update(
        { userId: '1' },
        { lastFeedSettingsFeedback: subDays(new Date(), 30) },
      );
    mockLoggedIn();
    const res = await request(app.server)
      .get(BASE_PATH)
      .set('User-Agent', TEST_UA)
      .set('Cookie', 'ory_kratos_session=value;')
      .expect(200);
    expect(res.body.alerts.shouldShowFeedFeedback).toBeTruthy();
  });
});
