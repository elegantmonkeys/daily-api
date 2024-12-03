import { expectSuccessfulTypedBackground, saveFixtures } from '../helpers';
import { postAddedSlackChannelSendWorker as worker } from '../../src/workers/postAddedSlackChannelSend';
import {
  ArticlePost,
  Feed,
  Post,
  Source,
  SourceType,
  SquadSource,
  User,
} from '../../src/entity';
import { sourcesFixture } from '../fixture/source';
import { postsFixture, vordrPostsFixture } from '../fixture/post';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import { typedWorkers } from '../../src/workers';
import { usersFixture } from '../fixture/user';
import {
  UserIntegration,
  UserIntegrationType,
} from '../../src/entity/UserIntegration';
import { encrypt } from '../../src/common/crypto';
import { UserSourceIntegrationSlack } from '../../src/entity/UserSourceIntegration';
import { ChangeObject } from '../../src/types';
import { SourceMemberRoles } from '../../src/roles';
import { addSeconds } from 'date-fns';
import { SlackApiErrorCode } from '../../src/errors';
import { ContentPreferenceStatus } from '../../src/entity/contentPreference/types';
import { ContentPreferenceSource } from '../../src/entity/contentPreference/ContentPreferenceSource';

const conversationsJoin = jest.fn().mockResolvedValue({
  ok: true,
});

const chatPostMessage = jest.fn().mockResolvedValue({
  ok: true,
});

jest.mock('@slack/web-api', () => ({
  ...(jest.requireActual('@slack/web-api') as Record<string, unknown>),
  WebClient: function () {
    return {
      conversations: {
        join: conversationsJoin,
      },
      chat: {
        postMessage: chatPostMessage,
      },
    };
  },
}));

let con: DataSource;

beforeAll(async () => {
  jest.clearAllMocks();
  con = await createOrGetConnection();
});

describe('postAddedSlackChannelSend worker', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    await saveFixtures(con, Source, sourcesFixture);
    await saveFixtures(con, ArticlePost, postsFixture);
    await saveFixtures(con, User, usersFixture);
    await saveFixtures(
      con,
      Feed,
      usersFixture.map((u) => ({ id: u.id, userId: u.id })),
    );
    await con.getRepository(SquadSource).save([
      {
        id: 'squadslackchannel',
        name: 'Squad Slack Channel',
        image: 'http//image.com/squadslackchannel',
        handle: 'squadslackchannel',
        type: SourceType.Squad,
        active: true,
        private: true,
      },
    ]);
    const createdAt = new Date();
    await con.getRepository(ContentPreferenceSource).save([
      {
        sourceId: 'squadslackchannel',
        referenceId: 'squadslackchannel',
        userId: '1',
        createdAt: addSeconds(createdAt, 2),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'squadslackchanneltoken2',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '1',
      },
      {
        sourceId: 'squadslackchannel',
        referenceId: 'squadslackchannel',
        userId: '2',
        createdAt: addSeconds(createdAt, 1),
        flags: {
          role: SourceMemberRoles.Admin,
          referralToken: 'squadslackchanneltoken1',
        },
        status: ContentPreferenceStatus.Subscribed,
        feedId: '2',
      },
    ]);
    const [userIntegration] = await con.getRepository(UserIntegration).save([
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
    await con.getRepository(UserSourceIntegrationSlack).save([
      {
        userIntegrationId: userIntegration.id,
        sourceId: 'a',
        channelIds: ['1'],
      },
      {
        userIntegrationId: userIntegration.id,
        sourceId: 'squadslackchannel',
        channelIds: ['1'],
      },
    ]);
  });

  it('should be registered', () => {
    const registeredWorker = typedWorkers.find(
      (item) => item.subscription === worker.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should send a message to the slack channel', async () => {
    const post = await con.getRepository(ArticlePost).findOneByOrFail({
      id: 'p1',
    });

    await expectSuccessfulTypedBackground(worker, {
      post: post as unknown as ChangeObject<ArticlePost>,
    });

    expect(conversationsJoin).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).toHaveBeenCalledTimes(1);

    expect(conversationsJoin).toHaveBeenCalledWith({
      channel: '1',
    });
    expect(chatPostMessage).toHaveBeenCalledWith({
      channel: '1',
      attachments: [
        {
          author_icon: 'http://image.com/a',
          author_name: 'A | daily.dev',
          image_url: 'https://daily.dev/image.jpg',
          title: 'P1',
          title_link:
            'http://localhost:5002/posts/p1?utm_source=notification&utm_medium=slack&utm_campaign=new_post',
        },
      ],
      text: 'New post: <http://localhost:5002/posts/p1?utm_source=notification&utm_medium=slack&utm_campaign=new_post|http://localhost:5002/posts/p1>',
      unfurl_links: false,
    });
  });

  it('should send a message to the slack channel for squad', async () => {
    await con.getRepository(Post).save([
      {
        ...postsFixture[0],
        id: 'squadslackchannelp1',
        title: 'Squad Channel Post 1',
        shortId: 'sschp1',
        url: 'http://localhost:5002/posts/squadslackchannelp1',
        canonicalUrl: 'http://localhost:5002/posts/squadslackchannelp1',
        sourceId: 'squadslackchannel',
      },
    ]);
    const post = await con.getRepository(ArticlePost).findOneByOrFail({
      id: 'squadslackchannelp1',
    });

    await expectSuccessfulTypedBackground(worker, {
      post: post as unknown as ChangeObject<ArticlePost>,
    });

    expect(conversationsJoin).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).toHaveBeenCalledTimes(1);

    expect(conversationsJoin).toHaveBeenCalledWith({
      channel: '1',
    });
    expect(chatPostMessage).toHaveBeenCalledWith({
      channel: '1',
      attachments: [
        {
          author_icon: 'http//image.com/squadslackchannel',
          author_name: 'Squad Slack Channel | daily.dev',
          image_url: 'https://daily.dev/image.jpg',
          title: 'Squad Channel Post 1',
          title_link:
            'http://localhost:5002/posts/squadslackchannelp1?utm_source=notification&utm_medium=slack&utm_campaign=new_post&jt=squadslackchanneltoken1&source=squadslackchannel&type=squad',
        },
      ],
      text: 'New post: <http://localhost:5002/posts/squadslackchannelp1?utm_source=notification&utm_medium=slack&utm_campaign=new_post&jt=squadslackchanneltoken1&source=squadslackchannel&type=squad|http://localhost:5002/posts/squadslackchannelp1>',
      unfurl_links: false,
    });
  });

  it('should send a message to the slack channel for public squad', async () => {
    await con.getRepository(SquadSource).update(
      {
        id: 'squadslackchannel',
      },
      {
        private: false,
      },
    );
    await con.getRepository(Post).save([
      {
        ...postsFixture[0],
        id: 'squadslackchannelp1',
        title: 'Squad Channel Post 1',
        shortId: 'sschp1',
        url: 'http://localhost:5002/posts/squadslackchannelp1',
        canonicalUrl: 'http://localhost:5002/posts/squadslackchannelp1',
        sourceId: 'squadslackchannel',
      },
    ]);
    const post = await con.getRepository(ArticlePost).findOneByOrFail({
      id: 'squadslackchannelp1',
    });

    await expectSuccessfulTypedBackground(worker, {
      post: post as unknown as ChangeObject<ArticlePost>,
    });

    expect(conversationsJoin).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).toHaveBeenCalledTimes(1);

    expect(conversationsJoin).toHaveBeenCalledWith({
      channel: '1',
    });
    expect(chatPostMessage).toHaveBeenCalledWith({
      channel: '1',
      attachments: [
        {
          author_icon: 'http//image.com/squadslackchannel',
          author_name: 'Squad Slack Channel | daily.dev',
          image_url: 'https://daily.dev/image.jpg',
          title: 'Squad Channel Post 1',
          title_link:
            'http://localhost:5002/posts/squadslackchannelp1?utm_source=notification&utm_medium=slack&utm_campaign=new_post',
        },
      ],
      text: 'New post: <http://localhost:5002/posts/squadslackchannelp1?utm_source=notification&utm_medium=slack&utm_campaign=new_post|http://localhost:5002/posts/squadslackchannelp1>',
      unfurl_links: false,
    });
  });

  it('should not send a message to the slack channel if the post source has no slack integrations', async () => {
    await con.getRepository(UserSourceIntegrationSlack).delete({});

    expect(conversationsJoin).toHaveBeenCalledTimes(0);
    expect(chatPostMessage).toHaveBeenCalledTimes(0);
  });

  it('should ignore if post or source do not exist', async () => {
    const post = await con.getRepository(ArticlePost).findOneByOrFail({
      id: 'p1',
    });

    await expectSuccessfulTypedBackground(worker, {
      post: {
        ...post,
        id: 'doesnotexistpost',
      } as unknown as ChangeObject<ArticlePost>,
    });

    expect(conversationsJoin).toHaveBeenCalledTimes(0);
    expect(chatPostMessage).toHaveBeenCalledTimes(0);
  });

  it('should send a message to the slack channel with author name', async () => {
    await con.getRepository(Post).save([
      {
        ...postsFixture[0],
        id: 'squadslackchannelp1',
        title: 'Squad Channel Post 1',
        shortId: 'sschp1',
        url: 'http://localhost:5002/posts/squadslackchannelp1',
        canonicalUrl: 'http://localhost:5002/posts/squadslackchannelp1',
        sourceId: 'squadslackchannel',
        authorId: '1',
      },
    ]);
    const post = await con.getRepository(ArticlePost).findOneByOrFail({
      id: 'squadslackchannelp1',
    });

    await expectSuccessfulTypedBackground(worker, {
      post: post as unknown as ChangeObject<ArticlePost>,
    });

    expect(conversationsJoin).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).toHaveBeenCalledTimes(1);

    expect(conversationsJoin).toHaveBeenCalledWith({
      channel: '1',
    });
    expect(chatPostMessage).toHaveBeenCalledWith({
      channel: '1',
      attachments: [
        {
          author_icon: 'http//image.com/squadslackchannel',
          author_name: 'Squad Slack Channel | daily.dev',
          image_url: 'https://daily.dev/image.jpg',
          title: 'Squad Channel Post 1',
          title_link:
            'http://localhost:5002/posts/squadslackchannelp1?utm_source=notification&utm_medium=slack&utm_campaign=new_post&jt=squadslackchanneltoken1&source=squadslackchannel&type=squad',
        },
      ],
      text: 'Ido shared a new post: <http://localhost:5002/posts/squadslackchannelp1?utm_source=notification&utm_medium=slack&utm_campaign=new_post&jt=squadslackchanneltoken1&source=squadslackchannel&type=squad|http://localhost:5002/posts/squadslackchannelp1>',
      unfurl_links: false,
    });
  });

  it('should send a message to the private slack channel', async () => {
    const post = await con.getRepository(ArticlePost).findOneByOrFail({
      id: 'p1',
    });

    conversationsJoin.mockRejectedValueOnce({
      message: 'An API error occurred',
      code: 'slack_webapi_platform_error',
      data: {
        ok: false,
        error: SlackApiErrorCode.MethodNotSupportedForChannelType,
      },
    });

    await expectSuccessfulTypedBackground(worker, {
      post: post as unknown as ChangeObject<ArticlePost>,
    });

    expect(conversationsJoin).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).toHaveBeenCalledTimes(1);

    expect(conversationsJoin).toHaveBeenCalledWith({
      channel: '1',
    });
    expect(chatPostMessage).toHaveBeenCalledWith({
      channel: '1',
      attachments: [
        {
          author_icon: 'http://image.com/a',
          author_name: 'A | daily.dev',
          image_url: 'https://daily.dev/image.jpg',
          title: 'P1',
          title_link:
            'http://localhost:5002/posts/p1?utm_source=notification&utm_medium=slack&utm_campaign=new_post',
        },
      ],
      text: 'New post: <http://localhost:5002/posts/p1?utm_source=notification&utm_medium=slack&utm_campaign=new_post|http://localhost:5002/posts/p1>',
      unfurl_links: false,
    });
  });

  describe('vordr', () => {
    beforeEach(async () => {
      await saveFixtures(con, ArticlePost, vordrPostsFixture);
    });

    it('should not send a message to the slack channel when the post is prevented by vordr', async () => {
      const post = await con.getRepository(ArticlePost).findOneByOrFail({
        id: 'vordr1',
      });

      const result = await expectSuccessfulTypedBackground(worker, {
        post: post as unknown as ChangeObject<ArticlePost>,
      });

      expect(result).toBeUndefined();
    });
  });
});
