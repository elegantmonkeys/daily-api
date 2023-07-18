import {
  NotificationPreference,
  NotificationPreferenceComment,
  NotificationPreferencePost,
  NotificationPreferenceSource,
} from '../entity';
import { ValidationError } from 'apollo-server-errors';
import { DataSource, EntityManager } from 'typeorm';

export enum NotificationType {
  CommunityPicksFailed = 'community_picks_failed',
  CommunityPicksSucceeded = 'community_picks_succeeded',
  CommunityPicksGranted = 'community_picks_granted',
  ArticlePicked = 'article_picked',
  ArticleNewComment = 'article_new_comment',
  ArticleUpvoteMilestone = 'article_upvote_milestone',
  ArticleReportApproved = 'article_report_approved',
  ArticleAnalytics = 'article_analytics',
  SourceApproved = 'source_approved',
  SourceRejected = 'source_rejected',
  CommentMention = 'comment_mention',
  CommentReply = 'comment_reply',
  CommentUpvoteMilestone = 'comment_upvote_milestone',
  SquadAccess = 'squad_access',
  SquadPostAdded = 'squad_post_added',
  SquadMemberJoined = 'squad_member_joined',
  SquadNewComment = 'squad_new_comment',
  SquadReply = 'squad_reply',
  SquadPostViewed = 'squad_post_viewed',
  SquadSubscribeToNotification = 'squad_subscribe_to_notification',
  SquadBlocked = 'squad_blocked',
  PromotedToAdmin = 'promoted_to_admin',
  DemotedToMember = 'demoted_to_member',
  PromotedToModerator = 'promoted_to_moderator',
  PostMention = 'post_mention',
}

export enum NotificationPreferenceType {
  Post = 'post',
  Comment = 'comment',
  Source = 'source',
}

export enum NotificationPreferenceStatus {
  Muted = 'muted',
}

export const notificationPreferenceMap: Partial<
  Record<NotificationType, NotificationPreferenceType>
> = {
  [NotificationType.ArticleNewComment]: NotificationPreferenceType.Post,
  [NotificationType.CommentReply]: NotificationPreferenceType.Comment,
  [NotificationType.SquadPostAdded]: NotificationPreferenceType.Source,
  [NotificationType.SquadMemberJoined]: NotificationPreferenceType.Source,
};

type NotificationPreferenceUnion = NotificationPreferenceComment &
  NotificationPreferencePost &
  NotificationPreferenceSource;

export const saveNotificationPreference = (
  con: DataSource | EntityManager,
  userId: string,
  referenceId: string,
  notificationType: NotificationType,
  status: NotificationPreferenceStatus,
) => {
  const type = notificationPreferenceMap[notificationType];

  if (!type) {
    throw new ValidationError('Notification type not supported');
  }

  const params: Partial<NotificationPreferenceUnion> = {
    type,
    userId,
    status,
    notificationType,
    uniqueKey: referenceId,
  };

  switch (type) {
    case NotificationPreferenceType.Comment:
      params.commentId = referenceId;
      break;
    case NotificationPreferenceType.Post:
      params.postId = referenceId;
      break;
    case NotificationPreferenceType.Source:
      params.sourceId = referenceId;
      break;
  }

  return con
    .getRepository(NotificationPreference)
    .createQueryBuilder()
    .insert()
    .values(params)
    .orIgnore()
    .execute();
};
