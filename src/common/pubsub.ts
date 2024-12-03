import { PubSub, Topic } from '@google-cloud/pubsub';
import { FastifyBaseLogger } from 'fastify';
import {
  Post,
  Settings,
  Submission,
  User,
  CommentMention,
  Feature,
  Source,
  ArticlePost,
  PostMention,
  Comment,
  ContentImage,
  Banner,
  FreeformPost,
  CollectionPost,
  NotificationV2,
  UserPersonalizedDigest,
} from '../entity';
import { ChangeMessage, ChangeObject } from '../types';
import { SourceMemberRoles } from '../roles';
import {
  addPubsubSpanLabels,
  opentelemetry,
  runInRootSpan,
  runInSpan,
} from '../telemetry';
import { Message } from '@google-cloud/pubsub';
// import { performance } from 'perf_hooks';
import { DataSource } from 'typeorm';
import { FastifyLoggerInstance } from 'fastify';
import pino from 'pino';
import { PersonalizedDigestFeatureConfig } from '../growthbook';
import { Message as ProtobufMessage } from '@bufbuild/protobuf';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';

export const pubsub = new PubSub();
const postCommentedTopic = pubsub.topic('post-commented');
const commentCommentedTopic = pubsub.topic('comment-commented');
const commentFeaturedTopic = pubsub.topic('comment-featured');
const commentsUpdateTopic = pubsub.topic('update-comments');
const usernameChangedTopic = pubsub.topic('username-changed');
const settingsUpdatedTopic = pubsub.topic('settings-updated');
const sendAnalyticsReportTopic = pubsub.topic('send-analytics-report');
const viewsTopic = pubsub.topic('views');
const postBannedOrRemovedTopic = pubsub.topic('post-banned-or-removed');
const sourceFeedAddedTopic = pubsub.topic('source-feed-added');
const sourceFeedRemovedTopic = pubsub.topic('source-feed-removed');
const communityLinkAccessTopic = pubsub.topic('community-link-access');
const communityLinkRejectedTopic = pubsub.topic('community-link-rejected');
const newNotificationTopic = pubsub.topic('api.v1.new-notification');
const newPostMentionTopic = pubsub.topic('api.v1.new-post-mention');
const newCommentMentionTopic = pubsub.topic('api.v1.new-comment-mention');
const memberJoinedSourceTopic = pubsub.topic('api.v1.member-joined-source');
const featureAccess = pubsub.topic('api.v1.feature-granted');
const sourcePrivacyUpdatedTopic = pubsub.topic('api.v1.source-privacy-updated');
const squadFeaturedUpdated = pubsub.topic('api.v1.squad-featured-updated');
const featuresResetTopic = pubsub.topic('features-reset');
const contentRequestedTopic = pubsub.topic('api.v1.content-requested');
const postVisibleTopic = pubsub.topic('api.v1.post-visible');
const bannerAddedTopic = pubsub.topic('api.v1.banner-added');
const bannerRemovedTopic = pubsub.topic('api.v1.banner-deleted');
const sourceMemberRoleChangedTopic = pubsub.topic(
  'api.v1.source-member-role-changed',
);
const contentImageDeletedTopic = pubsub.topic('api.v1.content-image-deleted');
const postContentEditedTopic = pubsub.topic('api.v1.post-content-edited');
const commentEditedTopic = pubsub.topic('api.v1.comment-edited');
const commentDeletedTopic = pubsub.topic('api.v1.comment-deleted');
const sourceCreatedTopic = pubsub.topic('api.v1.source-created');
const generatePersonalizedDigestTopic = pubsub.topic(
  'api.v1.generate-personalized-digest',
);
const postYggdrasilIdSet = pubsub.topic('api.v1.post-yggdrasil-id-set');
const postCollectionUpdatedTopic = pubsub.topic(
  'api.v1.post-collection-updated',
);
const userReadmeUpdatedTopic = pubsub.topic('api.v1.user-readme-updated');
const userReputationUpdatedTopic = pubsub.topic('user-reputation-updated');

export enum NotificationReason {
  New = 'new',
  Publish = 'publish',
  Approve = 'approve',
  Decline = 'decline',
  Exists = 'exists',
}

// Need to support console as well
export type EventLogger = Omit<FastifyBaseLogger, 'fatal'>;

export const publishEvent = async (
  log: EventLogger,
  topic: Topic,
  payload: unknown,
): Promise<void> =>
  runInSpan(
    `publishEvent ${topic.name}`,
    async () => {
      if (
        process.env.NODE_ENV === 'production' ||
        process.env.ENABLE_PUBSUB === 'true'
      ) {
        const isProtobufMessage = payload instanceof ProtobufMessage;

        try {
          await topic.publishMessage(
            isProtobufMessage
              ? {
                  data: Buffer.from(payload.toBinary()),
                }
              : {
                  json: payload,
                },
          );
        } catch (err) {
          log.error(
            { err, topic: topic.name, payload },
            'failed to publish message',
          );
        }
      }
    },
    {
      kind: opentelemetry.SpanKind.PRODUCER,
    },
  );

export const notifyPostCommented = async (
  log: EventLogger,
  postId: string,
  userId: string,
  commentId: string,
  contentHtml: string,
): Promise<void> =>
  publishEvent(log, postCommentedTopic, {
    postId,
    userId,
    commentId,
    contentHtml,
  });

export const notifyCommentCommented = async (
  log: EventLogger,
  postId: string,
  userId: string,
  parentCommentId: string,
  childCommentId: string,
  contentHtml: string,
): Promise<void> =>
  publishEvent(log, commentCommentedTopic, {
    postId,
    userId,
    parentCommentId,
    childCommentId,
    contentHtml,
  });

export const notifyCommentFeatured = async (
  log: EventLogger,
  commentId: string,
): Promise<void> =>
  publishEvent(log, commentFeaturedTopic, {
    commentId,
  });

export const notifyCommentsUpdate = async (
  log: EventLogger,
  oldUsername: string,
  newUsername: string,
  commentIds: string[],
): Promise<void> =>
  publishEvent(log, commentsUpdateTopic, {
    oldUsername,
    newUsername,
    commentIds,
  });

export const notifyUserReadmeUpdated = (
  log: EventLogger,
  user: ChangeObject<User>,
): Promise<void> => publishEvent(log, userReadmeUpdatedTopic, { user });

export const notifyUsernameChanged = (
  log: EventLogger,
  userId: string,
  oldUsername: string,
  newUsername: string,
): Promise<void> =>
  publishEvent(log, usernameChangedTopic, { userId, oldUsername, newUsername });

export const notifySettingsUpdated = (
  log: EventLogger,
  settings: ChangeObject<Settings>,
): Promise<void> => publishEvent(log, settingsUpdatedTopic, settings);

export const notifySourcePrivacyUpdated = (
  log: EventLogger,
  source: ChangeObject<Source>,
): Promise<void> => publishEvent(log, sourcePrivacyUpdatedTopic, { source });

export const notifySquadFeaturedUpdated = (
  log: EventLogger,
  squad: ChangeObject<Source>,
): Promise<void> => publishEvent(log, squadFeaturedUpdated, { squad });

export const notifySendAnalyticsReport = async (
  log: EventLogger,
  postId: string,
): Promise<void> =>
  publishEvent(log, sendAnalyticsReportTopic, {
    postId,
  });

export const notifyView = (
  log: EventLogger,
  postId: string,
  userId: string,
  referer: string | undefined,
  timestamp: Date,
  tags?: string[],
): Promise<void> =>
  publishEvent(log, viewsTopic, {
    postId,
    userId,
    referer,
    timestamp,
    tags,
  });

export const notifyPostBannedOrRemoved = async (
  log: EventLogger,
  post: ChangeObject<Post>,
): Promise<void> =>
  publishEvent(log, postBannedOrRemovedTopic, {
    post,
  });

export const notifySourceFeedAdded = async (
  log: EventLogger,
  sourceId: string,
  feed: string,
): Promise<void> =>
  publishEvent(log, sourceFeedAddedTopic, {
    feed,
    sourceId,
  });

export const notifySourceFeedRemoved = async (
  log: EventLogger,
  sourceId: string,
  feed: string,
): Promise<void> =>
  publishEvent(log, sourceFeedRemovedTopic, {
    feed,
    sourceId,
  });

export const notifySubmissionRejected = async (
  log: EventLogger,
  submission: ChangeObject<Submission>,
): Promise<void> => publishEvent(log, communityLinkRejectedTopic, submission);

export const notifySubmissionGrantedAccess = async (
  log: EventLogger,
  userId: string,
): Promise<void> => publishEvent(log, communityLinkAccessTopic, { userId });

export const notifySourceMemberRoleChanged = async (
  log: EventLogger,
  previousRole: SourceMemberRoles,
  sourceMember: ChangeObject<ContentPreferenceSource>,
): Promise<void> =>
  publishEvent(log, sourceMemberRoleChangedTopic, {
    previousRole,
    sourceMember,
  });

export const notifyNewNotification = async (
  log: EventLogger,
  notification: ChangeObject<NotificationV2>,
): Promise<void> => publishEvent(log, newNotificationTopic, { notification });

export const notifyNewPostMention = async (
  log: EventLogger,
  postMention: ChangeObject<PostMention>,
): Promise<void> => publishEvent(log, newPostMentionTopic, { postMention });

export const notifyNewCommentMention = async (
  log: EventLogger,
  commentMention: ChangeObject<CommentMention>,
): Promise<void> =>
  publishEvent(log, newCommentMentionTopic, { commentMention });

export const notifyMemberJoinedSource = async (
  log: EventLogger,
  sourceMember: ChangeObject<ContentPreferenceSource>,
): Promise<void> =>
  publishEvent(log, memberJoinedSourceTopic, { sourceMember });

export const notifyFeatureAccess = async (
  log: EventLogger,
  feature: ChangeObject<Feature>,
): Promise<void> => publishEvent(log, featureAccess, { feature });

export const notifyPostVisible = async (
  log: EventLogger,
  post: ChangeObject<Post>,
): Promise<void> => publishEvent(log, postVisibleTopic, { post });

export const notifyBannerCreated = async (
  log: EventLogger,
  banner: ChangeObject<Banner>,
): Promise<void> => publishEvent(log, bannerAddedTopic, { banner });

export const notifyBannerRemoved = async (
  log: EventLogger,
  banner: ChangeObject<Banner>,
): Promise<void> => publishEvent(log, bannerRemovedTopic, { banner });

export const notifyFeaturesReset = async (log: EventLogger): Promise<void> =>
  publishEvent(log, featuresResetTopic, {});

type ContentRequestedSubmission = { submissionId: string } & Pick<
  ArticlePost,
  'sourceId' | 'url'
>;
type ContentRequestedURL = Pick<ArticlePost, 'id' | 'origin' | 'url'>;
type ContentRequestedFreeForm = Pick<
  FreeformPost,
  'id' | 'content' | 'title'
> & {
  post_type: string;
};
export type ContentRequested =
  | ContentRequestedSubmission
  | ContentRequestedURL
  | ContentRequestedFreeForm;

export const notifyContentRequested = async (
  log: EventLogger,
  content: ContentRequested,
): Promise<void> => publishEvent(log, contentRequestedTopic, content);

export const notifyFreeformContentRequested = async (
  logger: EventLogger,
  freeform: ChangeMessage<FreeformPost>,
): Promise<void> => {
  const after = freeform.payload.after!;

  return notifyContentRequested(logger, {
    id: after.id,
    content: after.content,
    title: after.title,
    post_type: after.type,
  });
};

export const notifyContentImageDeleted = async (
  log: EventLogger,
  contentImage: ChangeObject<ContentImage>,
): Promise<void> =>
  publishEvent(log, contentImageDeletedTopic, { contentImage });

export const notifyPostContentEdited = async (
  log: EventLogger,
  post: ChangeObject<Post>,
): Promise<void> => publishEvent(log, postContentEditedTopic, { post });

export const notifyCommentEdited = async (
  log: EventLogger,
  comment: ChangeObject<Comment>,
): Promise<void> => publishEvent(log, commentEditedTopic, { comment });

export const notifyCommentDeleted = async (
  log: EventLogger,
  comment: ChangeObject<Comment>,
): Promise<void> => publishEvent(log, commentDeletedTopic, { comment });

export const notifySourceCreated = async (
  log: EventLogger,
  source: ChangeObject<Source>,
): Promise<void> => publishEvent(log, sourceCreatedTopic, { source });

export const notifyGeneratePersonalizedDigest = async ({
  log,
  personalizedDigest,
  emailSendTimestamp,
  previousSendTimestamp,
  emailBatchId,
  deduplicate,
  config,
}: {
  log: EventLogger;
  personalizedDigest: UserPersonalizedDigest;
  emailSendTimestamp: number;
  previousSendTimestamp: number;
  emailBatchId?: string;
  deduplicate?: boolean;
  config?: PersonalizedDigestFeatureConfig;
}): Promise<void> =>
  publishEvent(log, generatePersonalizedDigestTopic, {
    personalizedDigest,
    emailSendTimestamp,
    previousSendTimestamp,
    emailBatchId,
    deduplicate: deduplicate ?? true,
    config,
  });

export const notifyPostYggdrasilIdSet = async (
  log: EventLogger,
  post: ChangeObject<Post>,
): Promise<void> =>
  publishEvent(log, postYggdrasilIdSet, {
    post,
  });

export const notifyPostCollectionUpdated = async (
  log: EventLogger,
  post: ChangeObject<CollectionPost>,
): Promise<void> => publishEvent(log, postCollectionUpdatedTopic, { post });

export const notifyReputationIncrease = async (
  log: EventLogger,
  user: ChangeObject<User>,
  userAfter: ChangeObject<User>,
): Promise<void> =>
  publishEvent(log, userReputationUpdatedTopic, {
    user,
    userAfter,
  });

export const workerSubscribe = (
  logger: pino.Logger,
  pubsub: PubSub,
  connection: DataSource,
  subscription: string,
  handler: (
    message: Message,
    con: DataSource,
    logger: FastifyLoggerInstance,
    pubsub: PubSub,
  ) => Promise<void>,
  maxMessages = 1,
): void => {
  logger.info(`subscribing to ${subscription}`);
  const sub = pubsub.subscription(subscription, {
    flowControl: {
      maxMessages,
    },
    batching: { maxMilliseconds: 10 },
  });
  const childLogger = logger.child({ subscription });
  // const histogram = meter.createHistogram('message_processing_time', {
  //   unit: 'ms',
  //   description: 'time to process a message',
  // });
  sub.on('message', async (message) =>
    runInRootSpan(
      `message: ${subscription}`,
      async (span) => {
        // const startTime = performance.now();
        // let success = true;
        addPubsubSpanLabels(span, subscription, message);
        try {
          await runInSpan('handler', async () =>
            handler(message, connection, childLogger, pubsub),
          );
          message.ack();
        } catch (err) {
          // success = false;
          childLogger.error(
            {
              messageId: message.id,
              data: message.data.toString('utf-8'),
              err,
            },
            'failed to process message',
          );
          message.nack();
        }
        // histogram.record(performance.now() - startTime, {
        //   subscription,
        //   success,
        // });
      },
      {
        kind: opentelemetry.SpanKind.CONSUMER,
      },
    ),
  );
};
