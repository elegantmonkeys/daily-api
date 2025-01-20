import { messageToJson, Worker } from './worker';
import { ChangeObject } from '../types';
import {
  ArticlePost,
  CollectionPost,
  Comment,
  FreeformPost,
  getAuthorPostStats,
  NotificationAttachmentV2,
  NotificationAvatarV2,
  NotificationV2,
  Post,
  PostRelation,
  PostRelationType,
  PostType,
  SharePost,
  Source,
  SourceRequest,
  SquadPublicRequest,
  SquadSource,
  Submission,
  User,
  UserTopReader,
  WelcomePost,
} from '../entity';
import {
  addNotificationEmailUtm,
  baseNotificationEmailData,
  basicHtmlStrip,
  CioTransactionalMessageTemplateId,
  formatMailDate,
  getSourceLink,
  mapCloudinaryUrl,
  pickImageUrl,
  sendEmail,
  truncatePostToTweet,
  truncateToTweet,
} from '../common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { SubmissionFailErrorMessage } from '../errors';
import { simplifyComment } from '../notifications/builder';
import {
  getNotificationV2AndChildren,
  NotificationType,
  streamNotificationUsers,
} from '../notifications/common';
import { processStreamInBatches } from '../common/streaming';
import { counters } from '../telemetry';
import { contentPreferenceNotificationTypes } from '../common/contentPreference';
import { SourcePostModeration } from '../entity/SourcePostModeration';

interface Data {
  notification: ChangeObject<NotificationV2>;
}

export const notificationToTemplateId: Record<NotificationType, string> = {
  source_post_approved: '62',
  source_post_submitted: '61',
  source_post_rejected: '', // we won't send an email on rejected ones
  community_picks_failed: '28',
  community_picks_succeeded: '27',
  community_picks_granted: '26',
  article_picked: '32',
  article_new_comment: '33',
  article_upvote_milestone: '22',
  article_report_approved: '30',
  article_analytics: '31',
  source_approved: '34',
  source_rejected: '35',
  comment_mention: '29',
  comment_reply: '37',
  comment_upvote_milestone: '44',
  squad_post_added: '17',
  squad_member_joined: '18',
  squad_new_comment: '19',
  squad_reply: '20',
  squad_blocked: '',
  promoted_to_admin: '12',
  demoted_to_member: '',
  post_mention: '54',
  promoted_to_moderator: '13',
  squad_subscribe_to_notification: '',
  collection_updated: '11',
  dev_card_unlocked: '9',
  source_post_added: '8',
  squad_public_submitted: '42',
  squad_public_rejected: '43',
  squad_public_approved: '41',
  post_bookmark_reminder: '',
  streak_reset_restore: '',
  squad_featured: '56',
  user_post_added: '58',
  user_given_top_reader: CioTransactionalMessageTemplateId.UserGivenTopReader,
  user_gifted_plus: '', // todo: add template id
};

type TemplateData = Record<string, unknown>;

type TemplateDataFunc = (
  con: DataSource,
  user: Pick<User, 'id' | 'username' | 'permalink'>,
  notification: NotificationV2,
  attachments: NotificationAttachmentV2[],
  avatars: NotificationAvatarV2[],
) => Promise<TemplateData | null>;
const notificationToTemplateData: Record<NotificationType, TemplateDataFunc> = {
  source_post_approved: async (con, user, notification) => {
    const post = await con.getRepository(Post).findOne({
      where: { id: notification.referenceId },
    });

    if (!post) {
      return null;
    }

    const [squad, createdBy, sharedPost] = await Promise.all([
      con.getRepository(SquadSource).findOne({
        where: { id: post.sourceId },
        select: ['name', 'type', 'handle', 'image'],
      }),
      post.author,
      post.type === PostType.Share
        ? con.getRepository(ArticlePost).findOne({
            where: { id: (post as SharePost).sharedPostId },
            select: ['title', 'image'],
          })
        : Promise.resolve(null),
    ]);

    if (!squad || !createdBy) {
      return null;
    }

    return {
      full_name: createdBy.name,
      profile_image: createdBy.image,
      squad_name: squad.name,
      squad_image: squad.image,
      commenter_reputation: createdBy.reputation.toString(),
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      post_image: sharedPost?.image || (post as FreeformPost).image,
      post_title:
        post.type === PostType.Share ? sharedPost?.title || '' : post.title,
      commentary:
        post.type === PostType.Share
          ? post.title
          : (post as FreeformPost).content,
    };
  },
  source_post_submitted: async (con, user, notification) => {
    const moderation: Pick<
      SourcePostModeration,
      | 'createdById'
      | 'sourceId'
      | 'image'
      | 'title'
      | 'content'
      | 'type'
      | 'sharedPostId'
    > | null = await con.getRepository(SourcePostModeration).findOne({
      where: { id: notification.referenceId },
      select: [
        'createdById',
        'sourceId',
        'image',
        'title',
        'content',
        'type',
        'sharedPostId',
      ],
    });

    if (!moderation) {
      return null;
    }

    const { sharedPostId } = moderation;
    const [squad, createdBy, sharedPost, moderator]: [
      Pick<SquadSource, 'type' | 'name' | 'handle' | 'image'> | null,
      Pick<User, 'name' | 'reputation' | 'image'> | null,
      Pick<ArticlePost, 'title' | 'image'> | null,
      Pick<User, 'name' | 'reputation' | 'image'> | null,
    ] = await Promise.all([
      con.getRepository(SquadSource).findOne({
        where: { id: moderation.sourceId },
        select: ['type', 'name', 'handle', 'image'],
      }),
      con.getRepository(User).findOne({
        where: { id: moderation.createdById },
        select: ['name', 'image', 'reputation'],
      }),
      moderation.type === PostType.Share && sharedPostId
        ? con.getRepository(ArticlePost).findOne({
            where: { id: sharedPostId },
            select: ['title', 'image'],
          })
        : Promise.resolve(null),
      con.getRepository(User).findOne({
        where: { id: user.id },
        select: ['name', 'image', 'reputation'],
      }),
    ]);

    if (!squad || !createdBy || !moderator) {
      return null;
    }

    return {
      full_name: moderator.name,
      profile_image: createdBy.image,
      squad_name: squad.name,
      squad_image: squad.image,
      creator_name: createdBy.name,
      creator_reputation: createdBy.reputation.toString(),
      post_link: `${getSourceLink(squad)}/moderate`,
      post_image: (sharedPost as ArticlePost)?.image || moderation.image,
      post_title: sharedPost?.title || moderation.title,
      commentary:
        moderation.type === PostType.Share
          ? moderation.title
          : moderation.content,
    };
  },
  source_post_rejected: async () => null,
  post_bookmark_reminder: async () => null,
  streak_reset_restore: async () => null,
  community_picks_failed: async (con, user, notification) => {
    const submission = await con
      .getRepository(Submission)
      .findOneBy({ id: notification.referenceId });
    if (!submission) {
      return null;
    }
    return {
      submitted_at: formatMailDate(submission.createdAt),
      article_link: submission.url,
      reason:
        SubmissionFailErrorMessage[submission?.reason] ??
        SubmissionFailErrorMessage.GENERIC_ERROR,
    };
  },
  community_picks_succeeded: async (con, user, notification) => {
    const post = (await con
      .getRepository(Post)
      .findOneBy({ id: notification.referenceId })) as ArticlePost;
    const submission = await con
      .getRepository(Submission)
      .findOneByOrFail({ url: post.url!, userId: user.id });
    return {
      submitted_at: formatMailDate(submission.createdAt),
      post_title: truncatePostToTweet(post),
      post_image: post.image || pickImageUrl(post),
      article_link: post.url!,
      discussion_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  community_picks_granted: async () => {
    return {};
  },
  article_picked: async (con, user, notification, attachments) => {
    const att = attachments[0];
    return {
      post_title: truncatePostToTweet(att),
      post_image: att.image,
      discussion_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  article_new_comment: async (con, user, notification) => {
    const comment = await con.getRepository(Comment).findOne({
      where: { id: notification.referenceId },
      relations: ['post', 'user'],
    });
    if (!comment) {
      return null;
    }
    const [commenter, post] = await Promise.all([comment.user, comment.post]);
    return {
      profile_image: commenter.image,
      full_name: commenter.name,
      post_title: truncatePostToTweet(post),
      post_image: (post as ArticlePost).image || pickImageUrl(post),
      new_comment: notification.description!,
      discussion_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_reputation: commenter.reputation,
    };
  },
  article_upvote_milestone: async (con, user, notification, attachments) => {
    const att = attachments[0];
    return {
      post_title: truncatePostToTweet(att),
      post_image: att.image,
      discussion_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      upvotes: notification.uniqueKey!,
      upvote_title: basicHtmlStrip(notification.title),
    };
  },
  article_report_approved: async (con, user, notification) => {
    const post = await con
      .getRepository(Post)
      .findOneByOrFail({ id: notification.referenceId });
    return {
      post_title: truncatePostToTweet(post),
      post_image: (post as ArticlePost).image || pickImageUrl(post),
    };
  },
  article_analytics: async (con, user, notification) => {
    const [stats, post] = await Promise.all([
      getAuthorPostStats(con, user.id),
      con.getRepository(Post).findOneByOrFail({ id: notification.referenceId }),
    ]);
    return {
      post_image: (post as ArticlePost).image || pickImageUrl(post),
      post_title: truncatePostToTweet(post),
      post_views: post.views,
      post_upvotes: post.upvotes,
      post_comments: post.comments,
      profile_link: addNotificationEmailUtm(user.permalink, notification.type),
      post_views_total: stats.numPostViews,
      post_upvotes_total: stats.numPostUpvotes,
      post_comments_total: stats.numPostComments,
    };
  },
  source_approved: async (con, user, notification, attachments, avatars) => {
    const av = avatars[0];
    const sourceRequest = await con
      .getRepository(SourceRequest)
      .findOneByOrFail({ id: notification.referenceId });
    return {
      source_name: av.name,
      source_image: av.image,
      rss_link: sourceRequest.sourceFeed!,
      source_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  source_rejected: async (con, user, notification) => {
    const sourceRequest = await con
      .getRepository(SourceRequest)
      .findOneByOrFail({ id: notification.referenceId });
    return {
      rss_link: sourceRequest.sourceUrl,
    };
  },
  comment_mention: async (con, user, notification) => {
    const comment = await con.getRepository(Comment).findOne({
      where: { id: notification.referenceId },
      relations: ['post', 'user'],
    });
    if (!comment) {
      return null;
    }
    const [commenter, post] = await Promise.all([comment.user, comment.post]);
    return {
      full_name: commenter.name,
      commenter_profile_image: commenter.image,
      comment: notification.description!,
      post_image: (post as ArticlePost).image || pickImageUrl(post),
      post_title: truncatePostToTweet(post),
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_reputation: commenter.reputation,
    };
  },
  comment_reply: async (con, user, notification) => {
    const comment = await con.getRepository(Comment).findOne({
      where: { id: notification.referenceId },
      relations: ['parent', 'user', 'post'],
    });
    if (!comment) {
      return null;
    }
    const [commenter, parent, post] = await Promise.all([
      comment.user,
      comment.parent,
      comment.post,
    ]);
    if (!commenter || !parent || !post) {
      return null;
    }

    const parentUser = await parent.user;
    if (!parentUser) {
      return null;
    }

    return {
      user_profile_image: parentUser.image,
      full_name: commenter.name,
      main_comment: simplifyComment(parent.content),
      new_comment: notification.description!,
      post_title: truncatePostToTweet(post),
      discussion_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_reputation: parentUser.reputation,
      commenter_reputation: commenter.reputation,
      commenter_profile_image: commenter.image,
      user_name: parentUser.name,
    };
  },
  comment_upvote_milestone: async (con, user, notification) => {
    return {
      // Strip HTML tags
      upvote_title: basicHtmlStrip(notification.title),
      main_comment: notification.description!,
      discussion_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  squad_featured: async (con, _, notification) => {
    const source = await con.getRepository(Source).findOne({
      where: { id: notification.referenceId },
      select: ['name', 'image'],
    });

    if (!source) {
      return null;
    }

    return {
      squad_name: source.name,
      squad_image: source.image,
      squad_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  squad_member_joined: async (con, user, notification) => {
    const [joinedUser, post] = await Promise.all([
      con.getRepository(User).findOneBy({ id: notification.uniqueKey }),
      con
        .getRepository(WelcomePost)
        .findOneByOrFail({ id: notification.referenceId }),
    ]);
    const source = await post.source;
    if (!joinedUser || !source) {
      return null;
    }
    return {
      full_name: joinedUser.name,
      profile_image: joinedUser.image,
      squad_name: source.name,
      squad_image: source.image,
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_reputation: joinedUser.reputation,
      new_member_handle: joinedUser.username!,
    };
  },
  squad_post_added: async (con, user, notification) => {
    const post = await con.getRepository(Post).findOne({
      where: { id: notification.referenceId },
      relations: ['author', 'source'],
    });
    if (!post) {
      return null;
    }
    const [author, source, sharedPost] = await Promise.all([
      post.author,
      post.source,
      post.type === PostType.Share
        ? con.getRepository(Post).findOneBy({
            id: (post as SharePost)?.sharedPostId,
          })
        : null,
    ]);
    if (!author || !source) {
      return null;
    }

    const baseObject = {
      full_name: author.name,
      profile_image: author.image,
      squad_name: source.name,
      squad_image: source.image,
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_reputation: author.reputation,
    };

    if (post.type === PostType.Freeform) {
      return {
        ...baseObject,
        commentary: truncateToTweet((post as FreeformPost)?.content),
        post_image: (post as FreeformPost).image || pickImageUrl(post),
        post_title: truncatePostToTweet(post),
      };
    }

    if (sharedPost && post.type === PostType.Share) {
      return {
        ...baseObject,
        commentary: truncatePostToTweet(post),
        post_image:
          (sharedPost as ArticlePost).image || pickImageUrl(sharedPost),
        post_title: truncatePostToTweet(sharedPost),
      };
    }
    return null;
  },
  squad_new_comment: async (con, user, notification) => {
    const comment = await con.getRepository(Comment).findOne({
      where: { id: notification.referenceId },
      relations: ['post', 'user'],
    });
    if (!comment) {
      return null;
    }
    const [commenter, post] = [
      await comment.user,
      (await comment.post) as SharePost,
    ];
    if (!post || !post?.sharedPostId || !post?.authorId) {
      return null;
    }
    const [sharedPost, author, source] = await Promise.all([
      con.getRepository(Post).findOneBy({ id: post.sharedPostId }),
      post.author,
      post.source,
    ]);
    return {
      profile_image: commenter.image,
      full_name: commenter.name,
      squad_name: source.name,
      squad_image: source.image,
      post_title: truncatePostToTweet(sharedPost || undefined),
      post_image: (sharedPost as ArticlePost).image || pickImageUrl(post),
      new_comment: notification.description!,
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      commenter_reputation: commenter.reputation,
      user_name: author.name,
      user_reputation: author.reputation,
      user_image: author.image,
      commentary: truncatePostToTweet(post),
    };
  },
  squad_reply: async (con, user, notification) => {
    const comment = await con.getRepository(Comment).findOne({
      where: { id: notification.referenceId },
      relations: ['parent', 'user', 'post'],
    });
    if (!comment) {
      return null;
    }
    const [commenter, parent, post] = await Promise.all([
      comment.user,
      comment.parent,
      comment.post,
    ]);
    if (!commenter || !parent || !post) {
      return null;
    }

    const parentUser = await parent.user;
    if (!parentUser) {
      return null;
    }

    const source = await post.source;
    return {
      full_name: commenter.name,
      profile_image: commenter.image,
      squad_name: source.name,
      squad_image: source.image,
      commenter_reputation: commenter.reputation,
      new_comment: notification.description!,
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_name: parentUser.name,
      user_reputation: parentUser.reputation,
      user_image: parentUser.image,
      main_comment: simplifyComment(parent.content),
    };
  },
  squad_blocked: async () => {
    return null;
  },
  promoted_to_admin: async (con, user, notification) => {
    const source = await con
      .getRepository(Source)
      .findOneBy({ id: notification.referenceId });
    if (!source) {
      return null;
    }
    return {
      squad_name: source.name,
      squad_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  squad_subscribe_to_notification: async () => {
    return null;
  },
  demoted_to_member: async () => {
    return null;
  },
  post_mention: async (con, user, notification) => {
    const post = await con.getRepository(Post).findOne({
      where: { id: notification.referenceId },
      relations: ['author', 'source'],
    });
    if (!post) {
      return null;
    }
    const [author, source, sharedPost] = await Promise.all([
      post.author,
      post.source,
      post.type === PostType.Share
        ? con.getRepository(Post).findOneBy({
            id: (post as SharePost)?.sharedPostId,
          })
        : null,
    ]);
    if (!author || !source) {
      return null;
    }

    const baseObject = {
      full_name: author.name,
      profile_image: author.image,
      squad_name: source.name,
      squad_image: source.image,
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      user_reputation: author.reputation,
    };

    if (post.type === PostType.Freeform) {
      return {
        ...baseObject,
        commentary: truncateToTweet((post as FreeformPost)?.content),
        post_image: (post as FreeformPost).image || pickImageUrl(post),
        post_title: truncatePostToTweet(post),
      };
    }

    if (sharedPost && post.type === PostType.Share) {
      return {
        ...baseObject,
        commentary: truncatePostToTweet(post),
        post_image:
          (sharedPost as ArticlePost).image || pickImageUrl(sharedPost),
        post_title: truncatePostToTweet(sharedPost),
      };
    }
    return null;
  },
  promoted_to_moderator: async (con, user, notification) => {
    const source = await con
      .getRepository(Source)
      .findOneBy({ id: notification.referenceId });
    if (!source) {
      return null;
    }
    return {
      squad_name: source.name,
      squad_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
    };
  },
  collection_updated: async (con, user, notification) => {
    const post = await con.getRepository(CollectionPost).findOne({
      where: {
        id: notification.referenceId,
      },
    });

    if (!post) {
      return null;
    }

    const latestPostRelation = await con.getRepository(PostRelation).findOne({
      where: {
        postId: post.id,
        type: PostRelationType.Collection,
      },
      order: {
        createdAt: 'DESC',
      },
      relations: {
        relatedPost: {
          source: true,
        },
      },
    });

    if (!latestPostRelation) {
      return null;
    }

    const latestRelatedPost =
      (await latestPostRelation.relatedPost) as ArticlePost;
    const latestRelatedPostSource = await latestRelatedPost.source;

    return {
      post_title: truncatePostToTweet(post),
      post_image: post.image || pickImageUrl(post),
      post_upvotes: post.upvotes,
      post_comments: post.comments,
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      post_timestamp: formatMailDate(post.metadataChangedAt),
      source_title: truncatePostToTweet(latestRelatedPost),
      source_image: latestRelatedPost.image || pickImageUrl(latestRelatedPost),
      source_timestamp: formatMailDate(latestRelatedPost.createdAt),
      source_name: latestRelatedPostSource.name,
    };
  },
  dev_card_unlocked: async () => {
    return {};
  },
  source_post_added: async (con, user, notification) => {
    const post = (await con.getRepository(Post).findOne({
      where: {
        id: notification.referenceId,
      },
      relations: {
        source: true,
      },
    })) as ArticlePost;
    const source = await post.source;

    return {
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      post_image: post.image || pickImageUrl(post),
      post_title: truncatePostToTweet(post),
      source_name: source.name,
      source_image: source.image,
    };
  },
  squad_public_submitted: async (con, user, notification) => {
    const request = await con.getRepository(SquadPublicRequest).findOneOrFail({
      where: { id: notification.referenceId },
    });

    const squad = await request.source;

    return {
      squad_name: squad.name,
      squad_handle: squad.handle,
      squad_image: squad.image,
      timestamp: formatMailDate(request.createdAt),
    };
  },
  squad_public_rejected: async (con, user, notification) => {
    const request = await con.getRepository(SquadPublicRequest).findOneOrFail({
      where: { id: notification.referenceId },
      order: { createdAt: 'DESC' },
    });

    const squad = await request.source;

    return {
      squad_name: squad.name,
      squad_handle: squad.handle,
      squad_image: squad.image,
    };
  },
  squad_public_approved: async (con, user, notification) => {
    const request = await con.getRepository(SquadPublicRequest).findOneOrFail({
      where: { id: notification.referenceId },
      order: { createdAt: 'DESC' },
    });

    const squad = await request.source;

    return {
      squad_name: squad.name,
      squad_handle: squad.handle,
      squad_image: squad.image,
    };
  },
  user_post_added: async (con, user, notification) => {
    const [post, avatar] = await Promise.all([
      con.getRepository(Post).findOneOrFail({
        where: {
          id: notification.referenceId,
        },
      }),
      con.getRepository(NotificationAvatarV2).findOneOrFail({
        where: {
          id: notification.avatars[0],
        },
      }),
    ]);

    return {
      post_link: addNotificationEmailUtm(
        notification.targetUrl,
        notification.type,
      ),
      post_image: (post as ArticlePost).image || pickImageUrl(post),
      post_title: truncatePostToTweet(post),
      full_name: avatar.name,
      profile_image: avatar.image,
    };
  },
  user_given_top_reader: async (con, user, notification) => {
    const userTopReader = await con
      .getRepository(UserTopReader)
      .findOneByOrFail({
        userId: user.id,
        id: notification.referenceId,
      });

    const keyword = await userTopReader.keyword;
    if (!keyword) {
      throw new Error('Keyword not found');
    }

    return {
      image: userTopReader.image,
      issuedAt: formatMailDate(userTopReader.issuedAt),
      keyword: keyword?.flags?.title || keyword.value,
    };
  },
  user_gifted_plus: async () => {
    return null;
  },
};

const formatTemplateDate = <T extends TemplateData>(data: T): T => {
  return Object.keys(data).reduce((acc, key) => {
    switch (typeof data[key]) {
      case 'number':
        return { ...acc, [key]: (data[key] as number).toLocaleString() };
      case 'string':
        return { ...acc, [key]: mapCloudinaryUrl(data[key]) };
    }
    return acc;
  }, data);
};

const BATCH_SIZE = 1;
const QUEUE_CONCURRENCY = 100;

const worker: Worker = {
  subscription: 'api.new-notification-mail',
  handler: async (message, con, logger): Promise<void> => {
    const data: Data = messageToJson(message);
    const { id } = data.notification;
    const [notification, attachments, avatars] =
      await getNotificationV2AndChildren(con, id);
    if (!notification) {
      return;
    }
    const stream = await streamNotificationUsers(con, notification.id);
    try {
      await processStreamInBatches(
        stream,
        async (batch: { userId: string }[]) => {
          const isFollowNotification =
            contentPreferenceNotificationTypes.includes(notification.type);

          const users = await con.getRepository(User).find({
            select: ['id', 'username', 'email'],
            where: {
              id: In(batch.map((b) => b.userId)),
              email: Not(IsNull()),
              notificationEmail:
                !isFollowNotification && notification.public ? true : undefined,
              followingEmail:
                isFollowNotification && notification.public ? true : undefined,
            },
          });
          if (!users.length) {
            return;
          }
          await Promise.all(
            users.map(async (user) => {
              const templateDataFunc =
                notificationToTemplateData[notification.type];
              const templateData = await templateDataFunc(
                con,
                user,
                notification,
                attachments,
                avatars,
              );
              if (!templateData) {
                return;
              }
              const formattedData = formatTemplateDate(templateData);
              const templateId = notificationToTemplateId[notification.type];
              await sendEmail({
                ...baseNotificationEmailData,
                transactional_message_id: templateId,
                message_data: formattedData,
                identifiers: {
                  id: user.id,
                },
                to: user.email,
              });
            }),
          );
        },
        QUEUE_CONCURRENCY,
        BATCH_SIZE,
      );
    } catch (err) {
      logger.error(
        {
          err,
        },
        'failed to send notification email',
      );
      counters?.background?.notificationFailed?.add(1, { channel: 'email' });
    }
  },
};

export default worker;
