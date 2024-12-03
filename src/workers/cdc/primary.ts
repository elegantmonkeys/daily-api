import {
  UserState,
  UserStateKey,
  ReputationEvent,
  CommentMention,
  MarketingCta,
  UserMarketingCta,
  SquadPublicRequest,
  UserStreak,
  Bookmark,
  Alerts,
  UserTopReader,
  SquadSource,
  SourceType,
} from '../../entity';
import { messageToJson, Worker } from '../worker';
import {
  Comment,
  COMMUNITY_PICKS_SOURCE,
  Feed,
  Post,
  Settings,
  SourceFeed,
  SourceRequest,
  Submission,
  SubmissionStatus,
  User,
  Feature,
  Source,
  PostMention,
  FreeformPost,
  Banner,
  PostType,
  FREEFORM_POST_MINIMUM_CONTENT_LENGTH,
  FREEFORM_POST_MINIMUM_CHANGE_LENGTH,
  UserPost,
  PostRelation,
  PostRelationType,
  normalizeCollectionPostSources,
  CollectionPost,
  UserCompany,
} from '../../entity';
import {
  notifyCommentCommented,
  notifyPostBannedOrRemoved,
  notifyPostCommented,
  notifyPostReport,
  notifyCommentReport,
  notifySendAnalyticsReport,
  notifySourceFeedAdded,
  notifySourceFeedRemoved,
  notifySettingsUpdated,
  increaseReputation,
  decreaseReputation,
  notifySubmissionRejected,
  notifySubmissionGrantedAccess,
  NotificationReason,
  notifyUsernameChanged,
  notifyNewCommentMention,
  notifyMemberJoinedSource,
  notifyFeatureAccess,
  notifySourcePrivacyUpdated,
  notifyPostVisible,
  notifySourceMemberRoleChanged,
  notifyNewPostMention,
  notifyContentRequested,
  notifyContentImageDeleted,
  notifyPostContentEdited,
  notifyCommentEdited,
  notifyCommentDeleted,
  notifyBannerCreated,
  notifyBannerRemoved,
  notifyFreeformContentRequested,
  notifySourceCreated,
  notifyPostYggdrasilIdSet,
  notifyPostCollectionUpdated,
  notifyUserReadmeUpdated,
  triggerTypedEvent,
  notifyReputationIncrease,
  PubSubSchema,
  debeziumTimeToDate,
  shouldAllowRestore,
  isNumber,
  notifySquadFeaturedUpdated,
  DEFAULT_TIMEZONE,
  notifySourceReport,
  DayOfWeek,
  processApprovedModeratedPost,
} from '../../common';
import { ChangeMessage, ChangeObject, UserVote } from '../../types';
import { DataSource, IsNull } from 'typeorm';
import { FastifyBaseLogger } from 'fastify';
import { PostReport, ContentImage } from '../../entity';
import { updateAlerts } from '../../schema/alerts';
import { TypeOrmError, TypeORMQueryFailedError } from '../../errors';
import { CommentReport } from '../../entity/CommentReport';
import { getTableName, isChanged, notifyPostContentUpdated } from './common';
import { UserComment } from '../../entity/user/UserComment';
import {
  StorageKey,
  StorageTopic,
  generateStorageKey,
  submissionAccessThreshold,
} from '../../config';
import {
  deleteRedisKey,
  getRedisObject,
  setRedisObjectWithExpiry,
} from '../../redis';
import { counters } from '../../telemetry';
import {
  cancelReminderWorkflow,
  runReminderWorkflow,
} from '../../temporal/notifications/utils';
import { addDays, nextMonday, nextTuesday } from 'date-fns';
import {
  postReportReasonsMap,
  reportCommentReasonsMap,
  sourceReportReasonsMap,
} from '../../entity/common';
import { utcToZonedTime } from 'date-fns-tz';
import { SourceReport } from '../../entity/sources/SourceReport';
import {
  SourcePostModeration,
  SourcePostModerationStatus,
} from '../../entity/SourcePostModeration';
import { ContentPreferenceSource } from '../../entity/contentPreference/ContentPreferenceSource';
import { ContentPreference } from '../../entity/contentPreference/ContentPreference';
import { cleanupSourcePostModerationNotifications } from '../../notifications/common';
import {
  ContentPreferenceStatus,
  ContentPreferenceType,
} from '../../entity/contentPreference/types';

const isFreeformPostLongEnough = (
  freeform: ChangeMessage<FreeformPost>,
): boolean =>
  (freeform.payload.after!.title!.length || 0) +
    (freeform.payload.after!.content?.length || 0) >=
  FREEFORM_POST_MINIMUM_CONTENT_LENGTH;

const isFreeformPostChangeLongEnough = (
  freeform: ChangeMessage<FreeformPost>,
): boolean =>
  Math.abs(
    (freeform.payload.before!.content?.length || 0) -
      (freeform.payload.after!.content?.length || 0),
  ) >= FREEFORM_POST_MINIMUM_CHANGE_LENGTH;

const isCollectionUpdated = (
  collection: ChangeMessage<CollectionPost>,
): boolean =>
  collection.payload.before!.summary !== collection.payload.after!.summary ||
  collection.payload.before!.content !== collection.payload.after!.content;

const onSourceRequestChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<SourceRequest>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    // New source request
    await triggerTypedEvent(logger, 'pub-request', {
      reason: NotificationReason.New,
      sourceRequest: data.payload.after!,
    });
  } else if (data.payload.op === 'u') {
    if (!data.payload.before!.closed && data.payload.after!.closed) {
      if (data.payload.after!.approved) {
        // Source request published
        await triggerTypedEvent(logger, 'pub-request', {
          reason: NotificationReason.Publish,
          sourceRequest: data.payload.after!,
        });
      } else {
        // Source request declined
        await triggerTypedEvent(logger, 'pub-request', {
          reason: NotificationReason.Decline,
          sourceRequest: data.payload.after!,
        });
      }
    } else if (!data.payload.before!.approved && data.payload.after!.approved) {
      // Source request approved
      await triggerTypedEvent(logger, 'pub-request', {
        reason: NotificationReason.Approve,
        sourceRequest: data.payload.after!,
      });
    }
  }
};

const handleVoteCreated = async <TVoteTopic extends keyof PubSubSchema>({
  log,
  upvoteTopic,
  downvoteTopic,
  payload,
  vote,
}: {
  log: FastifyBaseLogger;
  upvoteTopic: TVoteTopic;
  downvoteTopic: TVoteTopic;
  payload: PubSubSchema[TVoteTopic];
  vote: UserVote;
}) => {
  if (vote === UserVote.Up) {
    await triggerTypedEvent(log, upvoteTopic, payload);
  } else if (vote === UserVote.Down) {
    await triggerTypedEvent(log, downvoteTopic, payload);
  }
};

const handleVoteUpdated = async <TVoteTopic extends keyof PubSubSchema>({
  log,
  upvoteTopic,
  downvoteTopic,
  upvoteCanceledTopic,
  downvoteCanceledTopic,
  payload,
  vote,
  payloadBefore,
  voteBefore,
}: {
  log: FastifyBaseLogger;
  upvoteTopic: TVoteTopic;
  downvoteTopic: TVoteTopic;
  upvoteCanceledTopic: TVoteTopic;
  downvoteCanceledTopic: TVoteTopic;
  payload: PubSubSchema[TVoteTopic];
  vote: UserVote;
  payloadBefore: PubSubSchema[TVoteTopic];
  voteBefore: UserVote;
}) => {
  const isVoteChanged = vote !== voteBefore;

  if (!isVoteChanged) {
    return;
  }

  const isVoteCanceled = voteBefore !== UserVote.None;

  if (isVoteCanceled) {
    await handleVoteDeleted({
      log,
      upvoteCanceledTopic,
      downvoteCanceledTopic,
      payloadBefore,
      voteBefore,
    });
  }

  if (vote !== UserVote.None) {
    await handleVoteCreated({
      log,
      upvoteTopic,
      downvoteTopic,
      payload,
      vote,
    });
  }
};

const handleVoteDeleted = async <TVoteTopic extends keyof PubSubSchema>({
  log,
  upvoteCanceledTopic,
  downvoteCanceledTopic,
  payloadBefore,
  voteBefore,
}: {
  log: FastifyBaseLogger;
  upvoteCanceledTopic: TVoteTopic;
  downvoteCanceledTopic: TVoteTopic;
  payloadBefore: PubSubSchema[TVoteTopic];
  voteBefore: UserVote;
}) => {
  if (voteBefore === UserVote.Up) {
    await triggerTypedEvent(log, upvoteCanceledTopic, payloadBefore);
  } else if (voteBefore === UserVote.Down) {
    await triggerTypedEvent(log, downvoteCanceledTopic, payloadBefore);
  }
};

const onPostVoteChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<UserPost>,
): Promise<void> => {
  switch (data.payload.op) {
    case 'c':
      await handleVoteCreated({
        log: logger,
        upvoteTopic: 'post-upvoted',
        downvoteTopic: 'api.v1.post-downvoted',
        payload: {
          postId: data.payload.after!.postId,
          userId: data.payload.after!.userId,
        },
        vote: data.payload.after!.vote,
      });
      break;
    case 'u':
      await handleVoteUpdated({
        log: logger,
        upvoteTopic: 'post-upvoted',
        downvoteTopic: 'api.v1.post-downvoted',
        upvoteCanceledTopic: 'post-upvote-canceled',
        downvoteCanceledTopic: 'api.v1.post-downvote-canceled',
        payload: {
          postId: data.payload.after!.postId,
          userId: data.payload.after!.userId,
        },
        vote: data.payload.after!.vote,
        payloadBefore: {
          postId: data.payload.before!.postId,
          userId: data.payload.before!.userId,
        },
        voteBefore: data.payload.before!.vote,
      });
      break;
    case 'd':
      await handleVoteDeleted({
        log: logger,
        upvoteCanceledTopic: 'post-upvote-canceled',
        downvoteCanceledTopic: 'api.v1.post-downvote-canceled',
        payloadBefore: {
          postId: data.payload.before!.postId,
          userId: data.payload.before!.userId,
        },
        voteBefore: data.payload.before!.vote,
      });
      break;
  }

  return;
};

const onCommentVoteChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<UserComment>,
): Promise<void> => {
  switch (data.payload.op) {
    case 'c':
      await handleVoteCreated({
        log: logger,
        upvoteTopic: 'comment-upvoted',
        downvoteTopic: 'api.v1.comment-downvoted',
        payload: {
          commentId: data.payload.after!.commentId,
          userId: data.payload.after!.userId,
        },
        vote: data.payload.after!.vote,
      });
      break;
    case 'u':
      await handleVoteUpdated({
        log: logger,
        upvoteTopic: 'comment-upvoted',
        downvoteTopic: 'api.v1.comment-downvoted',
        upvoteCanceledTopic: 'comment-upvote-canceled',
        downvoteCanceledTopic: 'api.v1.comment-downvote-canceled',
        payload: {
          commentId: data.payload.after!.commentId,
          userId: data.payload.after!.userId,
        },
        vote: data.payload.after!.vote,
        payloadBefore: {
          commentId: data.payload.before!.commentId,
          userId: data.payload.before!.userId,
        },
        voteBefore: data.payload.before!.vote,
      });
      break;
    case 'd':
      await handleVoteDeleted({
        log: logger,
        upvoteCanceledTopic: 'comment-upvote-canceled',
        downvoteCanceledTopic: 'api.v1.comment-downvote-canceled',
        payloadBefore: {
          commentId: data.payload.before!.commentId,
          userId: data.payload.before!.userId,
        },
        voteBefore: data.payload.before!.vote,
      });
      break;
  }
};

const onPostMentionChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<PostMention>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    await notifyNewPostMention(logger, data.payload.after!);
  }
};

const onCommentMentionChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<CommentMention>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    await notifyNewCommentMention(logger, data.payload.after!);
  }
};

const onCommentChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Comment>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    if (data.payload.after!.parentId) {
      await notifyCommentCommented(
        logger,
        data.payload.after!.postId,
        data.payload.after!.userId,
        data.payload.after!.parentId,
        data.payload.after!.id,
        data.payload.after!.contentHtml,
      );
    } else {
      await notifyPostCommented(
        logger,
        data.payload.after!.postId,
        data.payload.after!.userId,
        data.payload.after!.id,
        data.payload.after!.contentHtml,
      );
    }
  } else if (data.payload.op === 'u') {
    if (data.payload.before!.contentHtml !== data.payload.after!.contentHtml) {
      await notifyCommentEdited(logger, data.payload.after!);
    }
  } else if (data.payload.op === 'd') {
    await notifyCommentDeleted(logger, data.payload.before!);
  }
};

const onUserChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<User>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    await triggerTypedEvent(logger, 'api.v1.user-created', {
      user: data.payload.after!,
    });
  } else if (data.payload.op === 'u') {
    await triggerTypedEvent(logger, 'user-updated', {
      user: data.payload.before!,
      newProfile: data.payload.after!,
    });
    if (
      data.payload.after!.reputation >= submissionAccessThreshold &&
      data.payload.before!.reputation < submissionAccessThreshold
    ) {
      try {
        await con.getRepository(UserState).insert({
          userId: data.payload.after!.id,
          key: UserStateKey.CommunityLinkAccess,
          value: true,
        });
      } catch (originalError) {
        const ex = originalError as TypeORMQueryFailedError;

        if (ex.code !== TypeOrmError.DUPLICATE_ENTRY) {
          throw ex;
        }
      }
    }
    if (data.payload.after!.reputation > data.payload.before!.reputation) {
      await notifyReputationIncrease(
        logger,
        data.payload.before!,
        data.payload.after!,
      );
    }
    if (
      data.payload.before!.infoConfirmed &&
      data.payload.before!.username !== data.payload.after!.username
    ) {
      await notifyUsernameChanged(
        logger,
        data.payload.before!.id,
        data.payload.before!.username!,
        data.payload.after!.username!,
      );
    }
    if (data.payload.before!.readme !== data.payload.after!.readme) {
      await notifyUserReadmeUpdated(logger, data.payload.after!);
    }
  }
  if (data.payload.op === 'd') {
    await triggerTypedEvent(logger, 'user-deleted', {
      id: data.payload.before!.id,
      kratosUser: true,
      email: data.payload.before!.email,
    });
  }
};
const onSettingsChange = async (
  _: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Settings>,
): Promise<void> => {
  if (data.payload.op === 'u') {
    await notifySettingsUpdated(logger, data.payload.after!);
  } else if (data.payload.op === 'c') {
    await notifySettingsUpdated(logger, data.payload.after!);
  }
};

const onPostChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Post>,
): Promise<void> => {
  if (data.payload.after?.yggdrasilId && !data.payload.before?.yggdrasilId) {
    await notifyPostYggdrasilIdSet(logger, data.payload.after);
  }
  if (data.payload.op === 'c') {
    if (data.payload.after!.visible) {
      await notifyPostVisible(logger, data.payload.after!);
    }
    if (data.payload.after!.type === PostType.Freeform) {
      const freeform = data as ChangeMessage<FreeformPost>;
      if (isFreeformPostLongEnough(freeform)) {
        await notifyFreeformContentRequested(logger, freeform);
      }
    }
  } else if (data.payload.op === 'u') {
    await notifyPostContentUpdated({ con, post: data.payload.after! });

    if (data.payload.after!.visible) {
      if (!data.payload.before!.visible) {
        await notifyPostVisible(logger, data.payload.after!);
      } else {
        // Trigger message only if the post is already visible and the conte was edited
        const freeform = data as ChangeMessage<FreeformPost>;
        if (
          isChanged(
            freeform.payload.before!,
            freeform.payload.after!,
            'content',
          )
        ) {
          await notifyPostContentEdited(logger, data.payload.after!);
        }
      }
    }

    if (data.payload.after!.type === PostType.Collection) {
      const collection = data as ChangeMessage<CollectionPost>;
      if (isCollectionUpdated(collection)) {
        await notifyPostCollectionUpdated(logger, collection.payload.after!);
      }
    }

    if (data.payload.after!.type === PostType.Freeform) {
      const freeform = data as ChangeMessage<FreeformPost>;
      if (isFreeformPostChangeLongEnough(freeform)) {
        await notifyFreeformContentRequested(logger, freeform);
      }
    }

    if (
      !data.payload.before!.sentAnalyticsReport &&
      data.payload.after!.sentAnalyticsReport
    ) {
      await notifySendAnalyticsReport(logger, data.payload.after!.id);
    }
    if (
      !data.payload.before!.banned &&
      !data.payload.before!.deleted &&
      (data.payload.after!.banned || data.payload.after!.deleted)
    ) {
      await notifyPostBannedOrRemoved(logger, data.payload.after!);
    }
    if (
      isChanged(data.payload.before!, data.payload.after!, 'deleted') ||
      isChanged(data.payload.before!, data.payload.after!, 'banned') ||
      isChanged(data.payload.before!, data.payload.after!, 'tagsStr') ||
      isChanged(data.payload.before!, data.payload.after!, 'flags')
    ) {
      await con
        .getRepository(Post)
        .update(
          { id: data.payload.before!.id },
          { metadataChangedAt: new Date() },
        );
    }
  }
};

const onSourceReportChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<SourceReport>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    const source = await con
      .getRepository(Source)
      .findOneBy({ id: data.payload.after!.sourceId });
    if (source) {
      await notifySourceReport(
        data.payload.after!.userId,
        source,
        sourceReportReasonsMap.get(data.payload.after!.reason)!,
        data.payload.after!.comment,
      );
    }
  }
};

const onPostReportChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<PostReport>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    const post = await con
      .getRepository(Post)
      .findOneBy({ id: data.payload.after!.postId });
    if (post) {
      await notifyPostReport(
        data.payload.after!.userId,
        post,
        postReportReasonsMap.get(data.payload.after!.reason)!,
        data.payload.after!.comment,
        data.payload.after!.tags,
      );
    }
  }
};

const onCommentReportChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<CommentReport>,
) => {
  if (data.payload.op === 'c') {
    const comment = await con
      .getRepository(Comment)
      .findOneBy({ id: data.payload.after!.commentId });
    if (comment) {
      await notifyCommentReport(
        data.payload.after!.userId,
        comment,
        reportCommentReasonsMap.get(data.payload.after!.reason)!,
        data.payload.after!.note,
      );
    }
  }
};

const onSourceFeedChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<SourceFeed>,
): Promise<void> => {
  if (data.payload.op === 'c') {
    await notifySourceFeedAdded(
      logger,
      data.payload.after!.sourceId,
      data.payload.after!.feed,
    );
  } else if (data.payload.op === 'd') {
    await notifySourceFeedRemoved(
      logger,
      data.payload.before!.sourceId,
      data.payload.before!.feed,
    );
  }
};

const onBannerChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Banner>,
) => {
  if (data.payload.op === 'c') {
    await notifyBannerCreated(logger, data.payload.after!);
  }
  if (data.payload.op === 'd') {
    await notifyBannerRemoved(logger, data.payload.before!);
  }
};

const onSourceChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Source>,
) => {
  if (data.payload.op === 'c') {
    await notifySourceCreated(logger, data.payload.after!);

    return;
  }

  if (data.payload.op === 'u') {
    // Temporary workaround to handle messages before replica identity full
    if (!data.payload.before) {
      return;
    }
    if (data.payload.before!.private !== data.payload.after!.private) {
      await notifySourcePrivacyUpdated(logger, data.payload.after!);
    }

    const beforeFlags = data.payload.before.flags as unknown as string;
    const afterFlags = data.payload.after!.flags as unknown as string;
    const before = JSON.parse(beforeFlags || '{}') as Source['flags'];
    const after = JSON.parse(afterFlags || '{}') as Source['flags'];
    if (before.featured !== after.featured && after.featured) {
      notifySquadFeaturedUpdated(logger, {
        ...data.payload.after!,
        flags: after,
      });
    }

    const squadAfter = data.payload.after as ChangeObject<SquadSource>;
    const squadBefore = data.payload.before as ChangeObject<SquadSource>;

    if (
      squadBefore.moderationRequired !== squadAfter.moderationRequired &&
      !squadAfter.moderationRequired
    ) {
      await con.getRepository(SourcePostModeration).update(
        {
          sourceId: squadAfter.id,
          status: SourcePostModerationStatus.Pending,
        },
        { status: SourcePostModerationStatus.Approved },
      );
    }
  }
};

const onSourcePostModerationChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<SourcePostModeration>,
) => {
  if (data.payload.op === 'c') {
    await triggerTypedEvent(logger, 'api.v1.source-post-moderation-submitted', {
      post: data.payload.after!,
    });
  }

  if (data.payload.op === 'd') {
    await cleanupSourcePostModerationNotifications(con, data.payload.before!);
  }

  if (data.payload.op === 'u') {
    if (
      data.payload.before!.status !== SourcePostModerationStatus.Rejected &&
      data.payload.after!.status === SourcePostModerationStatus.Rejected
    ) {
      const post = data.payload.after!;
      await cleanupSourcePostModerationNotifications(con, post);
      await triggerTypedEvent(
        logger,
        'api.v1.source-post-moderation-rejected',
        { post },
      );
    }

    if (
      data.payload.before!.status !== SourcePostModerationStatus.Approved &&
      data.payload.after!.status === SourcePostModerationStatus.Approved
    ) {
      const post = await processApprovedModeratedPost(con, data.payload.after!);

      if (!post) {
        return;
      }

      if (post.postId) {
        await cleanupSourcePostModerationNotifications(con, post);
        await triggerTypedEvent(
          logger,
          'api.v1.source-post-moderation-approved',
          { post },
        );
      }
    }
  }
};

const onFeedChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Feed>,
) => {
  if (data.payload.op === 'c') {
    await updateAlerts(con, data.payload.after!.userId, { myFeed: 'created' });
  }
};

const onReputationEventChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<ReputationEvent>,
) => {
  if (data.payload.op === 'c') {
    const entity = data.payload.after!;
    await increaseReputation(con, logger, entity.grantToId, entity.amount);
  } else if (data.payload.op === 'd') {
    const entity = data.payload.before!;
    await decreaseReputation(con, logger, entity.grantToId, entity.amount);
  }
};

const onSubmissionChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Submission>,
) => {
  if (data.payload.op === 'c') {
    const entity = data.payload.after!;

    await notifyContentRequested(logger, {
      url: entity.url,
      sourceId: COMMUNITY_PICKS_SOURCE,
      submissionId: entity.id,
    });
  } else if (data.payload.op === 'u') {
    const entity = data.payload.after!;

    if (entity.status === SubmissionStatus.Rejected) {
      await notifySubmissionRejected(logger, entity);
    }
  }
};

const onUserStateChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<UserState>,
) => {
  if (data.payload.op === 'c') {
    if (data.payload.after!.key === UserStateKey.CommunityLinkAccess) {
      await notifySubmissionGrantedAccess(logger, data.payload.after!.userId);
    }
  }
};

const onSourceMemberChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<ContentPreferenceSource>,
) => {
  const contentPreferenceType = data.payload.after!.type;

  if (contentPreferenceType === ContentPreferenceType.Source) {
    const sourceId = data.payload.after!.sourceId;

    const source = await con
      .getRepository(Source)
      .createQueryBuilder()
      .select('type')
      .where({
        id: sourceId,
      })
      .getRawOne<Pick<Source, 'type'>>();

    if (source?.type !== SourceType.Squad) {
      return;
    }

    const isMemberBlockingSource =
      data.payload.after?.status === ContentPreferenceStatus.Blocked;

    if (data.payload.op === 'c' && !isMemberBlockingSource) {
      await notifyMemberJoinedSource(logger, data.payload.after!);
    }
    if (data.payload.op === 'u') {
      if (data.payload.before!.flags.role !== data.payload.after!.flags.role) {
        await notifySourceMemberRoleChanged(
          logger,
          data.payload.before!.flags.role!,
          data.payload.after!,
        );
      }
    }
  }
};

const onContentImageChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<ContentImage>,
) => {
  if (data.payload.op === 'd') {
    await notifyContentImageDeleted(logger, data.payload.before!);
  }
};

const onFeatureChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Feature>,
) => {
  if (data.payload.op === 'c') {
    await notifyFeatureAccess(logger, data.payload.after!);
  }
};

const onPostRelationChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<PostRelation>,
) => {
  if (data.payload.op === 'c') {
    if (data.payload.after!.type === PostRelationType.Collection) {
      await normalizeCollectionPostSources({
        con,
        postId: data.payload.after!.postId,
      });
    }
  }
};

const onMarketingCtaChange = async (
  con: DataSource,
  data: ChangeMessage<MarketingCta>,
) => {
  if (data.payload.op !== 'u') {
    return;
  }

  const users = await con.getRepository(UserMarketingCta).findBy({
    marketingCtaId: data.payload.after!.campaignId,
    readAt: IsNull(),
  });

  if (users.length > 0) {
    await deleteRedisKey(
      ...users.map((user) =>
        generateStorageKey(
          StorageTopic.Boot,
          StorageKey.MarketingCta,
          user.userId,
        ),
      ),
    );
  }
};

const onSquadPublicRequestChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<SquadPublicRequest>,
) => {
  if (data.payload.op === 'd') {
    return;
  }
  await triggerTypedEvent(logger, 'api.v1.squad-public-request', {
    request: data.payload.after!,
  });
};

const WEEKEND_MAP: Partial<Record<DayOfWeek, DayOfWeek[]>> = {
  [DayOfWeek.Sunday]: [5, 6],
  [DayOfWeek.Monday]: [6, 0],
};

const getNextWeekday = (todayTz: Date, weekStart: DayOfWeek): Date => {
  const weekends = WEEKEND_MAP[weekStart];

  if (!weekends) {
    throw new Error('Invalid week start: ' + weekStart);
  }

  if (!weekends.includes(todayTz.getDay())) {
    return addDays(todayTz, 1);
  }

  const weekStartEndOfDay =
    weekStart === DayOfWeek.Sunday ? nextMonday(todayTz) : nextTuesday(todayTz);

  return weekStartEndOfDay;
};

const getNextWeekdayInSeconds = (user: User): number => {
  const { weekStart } = user;
  const today = utcToZonedTime(new Date(), user.timezone || DEFAULT_TIMEZONE);
  const weekday = getNextWeekday(today, weekStart);
  const startOfDay = weekday.setHours(0, 0, 0, 0);

  return Math.round((startOfDay - today.getTime()) / 1000);
};

const setRestoreStreakCache = async (
  con: DataSource,
  streak: ChangeObject<UserStreak>,
) => {
  const { userId, currentStreak: previousStreak } = streak;
  const user = await con.getRepository(User).findOneBy({ id: userId });

  if (!user) {
    return;
  }

  const shouldAllow = await shouldAllowRestore(con, streak, user);

  if (!shouldAllow) {
    return;
  }

  const key = generateStorageKey(StorageTopic.Streak, StorageKey.Reset, userId);
  const differenceInSeconds = getNextWeekdayInSeconds(user);

  await Promise.all([
    setRedisObjectWithExpiry(key, previousStreak, differenceInSeconds),
    con.getRepository(Alerts).update({ userId }, { showRecoverStreak: true }),
  ]);
};

export const getRestoreStreakCache = async ({
  userId,
}: {
  userId: User['id'];
}): Promise<null | number> => {
  const key = generateStorageKey(StorageTopic.Streak, StorageKey.Reset, userId);
  const oldStreakLength = Number(await getRedisObject(key));
  const userDoesntHaveOldStreak =
    !oldStreakLength || !isNumber(oldStreakLength);

  if (userDoesntHaveOldStreak) {
    return null;
  }

  return oldStreakLength;
};

const VALID_STREAK_RESET = 3;

const onUserStreakChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<UserStreak>,
) => {
  if (data.payload.op === 'u') {
    if (
      data.payload.after!.currentStreak === 0 &&
      data.payload.before!.currentStreak >= VALID_STREAK_RESET
    ) {
      await setRestoreStreakCache(con, data.payload.before!);
    }

    await triggerTypedEvent(logger, 'api.v1.user-streak-updated', {
      streak: data.payload.after!,
    });
  }
};

const onUserCompanyCompanyChange = async (
  _: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<UserCompany>,
) => {
  const creationWithCompany =
    data.payload.op === 'c' && !!data.payload.after?.companyId;
  const updateWithDifferentCompany =
    data.payload.op === 'u' &&
    !!data.payload.after?.companyId &&
    data.payload.before?.companyId !== data.payload.after?.companyId;
  if (creationWithCompany || updateWithDifferentCompany) {
    await triggerTypedEvent(logger, 'api.v1.user-company-approved', {
      userCompany: data.payload.after!,
    });
  }
};

const onUserTopReaderChange = async (
  _: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<UserTopReader>,
) => {
  if (data.payload.op !== 'c') {
    return;
  }
  await triggerTypedEvent(logger, 'api.v1.user-top-reader', {
    userTopReader: data.payload.after!,
  });
};

const onBookmarkChange = async (
  con: DataSource,
  logger: FastifyBaseLogger,
  data: ChangeMessage<Bookmark>,
) => {
  const getParams = (key: 'before' | 'after') => ({
    userId: data.payload[key]!.userId,
    postId: data.payload[key]!.postId,
    remindAt: debeziumTimeToDate(data.payload[key]!.remindAt).getTime(),
  });

  if (data.payload.before?.remindAt) {
    cancelReminderWorkflow(getParams('before'));
  }

  if (data.payload.after?.remindAt) {
    runReminderWorkflow(getParams('after'));
  }
};

const worker: Worker = {
  subscription: 'api-cdc',
  maxMessages: parseInt(process.env.CDC_WORKER_MAX_MESSAGES) || undefined,
  handler: async (message, con, logger): Promise<void> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: ChangeMessage<any> = messageToJson(message);
      if (
        data.schema.name === 'io.debezium.connector.common.Heartbeat' ||
        data.payload.op === 'r'
      ) {
        return;
      }
      counters?.background?.cdcTrigger?.add(1, {
        table: data.payload.source.table,
      });
      switch (data.payload.source.table) {
        case getTableName(con, Banner):
          await onBannerChange(con, logger, data);
          break;
        case getTableName(con, Source):
          await onSourceChange(con, logger, data);
          break;
        case getTableName(con, SourcePostModeration):
          await onSourcePostModerationChange(con, logger, data);
          break;
        case getTableName(con, Feed):
          await onFeedChange(con, logger, data);
          break;
        case getTableName(con, SourceRequest):
          await onSourceRequestChange(con, logger, data);
          break;
        case getTableName(con, UserPost):
          await onPostVoteChange(con, logger, data);
          break;
        case getTableName(con, UserComment):
          await onCommentVoteChange(con, logger, data);
          break;
        case getTableName(con, CommentMention):
          await onCommentMentionChange(con, logger, data);
          break;
        case getTableName(con, PostMention):
          await onPostMentionChange(con, logger, data);
          break;
        case getTableName(con, Comment):
          await onCommentChange(con, logger, data);
          break;
        case getTableName(con, User):
          await onUserChange(con, logger, data);
          break;
        case getTableName(con, Post):
          await onPostChange(con, logger, data);
          break;
        case getTableName(con, PostReport):
          await onPostReportChange(con, logger, data);
          break;
        case getTableName(con, SourceReport):
          await onSourceReportChange(con, logger, data);
          break;
        case getTableName(con, CommentReport):
          await onCommentReportChange(con, logger, data);
          break;
        case getTableName(con, SourceFeed):
          await onSourceFeedChange(con, logger, data);
          break;
        case getTableName(con, Settings):
          await onSettingsChange(con, logger, data);
          break;
        case getTableName(con, ReputationEvent):
          await onReputationEventChange(con, logger, data);
          break;
        case getTableName(con, Submission):
          await onSubmissionChange(con, logger, data);
          break;
        case getTableName(con, UserState):
          await onUserStateChange(con, logger, data);
          break;
        case getTableName(con, ContentPreference):
          await onSourceMemberChange(con, logger, data);
          break;
        case getTableName(con, Feature):
          await onFeatureChange(con, logger, data);
          break;
        case getTableName(con, ContentImage):
          await onContentImageChange(con, logger, data);
          break;
        case getTableName(con, PostRelation):
          await onPostRelationChange(con, logger, data);
          break;
        case getTableName(con, SquadPublicRequest):
          await onSquadPublicRequestChange(con, logger, data);
          break;
        case getTableName(con, MarketingCta):
          await onMarketingCtaChange(con, data);
          break;
        case getTableName(con, UserStreak):
          await onUserStreakChange(con, logger, data);
          break;
        case getTableName(con, Bookmark):
          await onBookmarkChange(con, logger, data);
          break;
        case getTableName(con, UserCompany):
          await onUserCompanyCompanyChange(con, logger, data);
          break;
        case getTableName(con, UserTopReader):
          await onUserTopReaderChange(con, logger, data);
          break;
      }
    } catch (err) {
      logger.error(
        {
          messageId: message.messageId,
          err,
        },
        'failed to handle cdc message',
      );
      throw err;
    }
  },
};

export default worker;
