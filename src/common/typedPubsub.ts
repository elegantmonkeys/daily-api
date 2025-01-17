import { ChangeObject, type ContentLanguage } from '../types';
import type {
  Post,
  SourceRequest,
  SquadPublicRequest,
  SquadSource,
  User,
  UserStreak,
  UserCompany,
  UserTopReader,
  PostTranslation,
} from '../entity';
import {
  type EventLogger,
  NotificationReason,
  publishEvent,
  pubsub,
} from './pubsub';
import { ContentUpdatedMessage } from '@dailydotdev/schema';
import { SourcePostModeration } from '../entity/SourcePostModeration';

export type PubSubSchema = {
  'pub-request': {
    reason: NotificationReason;
    sourceRequest: ChangeObject<SourceRequest>;
  };
  'post-upvoted': {
    postId: string;
    userId: string;
  };
  'post-upvote-canceled': {
    postId: string;
    userId: string;
  };
  'api.v1.post-downvoted': {
    postId: string;
    userId: string;
  };
  'api.v1.post-downvote-canceled': {
    postId: string;
    userId: string;
  };
  'comment-upvoted': {
    commentId: string;
    userId: string;
  };
  'comment-upvote-canceled': {
    commentId: string;
    userId: string;
  };
  'api.v1.comment-downvoted': {
    commentId: string;
    userId: string;
  };
  'api.v1.comment-downvote-canceled': {
    commentId: string;
    userId: string;
  };
  'user-updated': {
    user: ChangeObject<User>;
    newProfile: ChangeObject<User>;
  };
  'user-deleted': {
    id: string;
    kratosUser: boolean;
    email: string;
  };
  'api.v1.user-created': {
    user: ChangeObject<User>;
  };
  'api.v1.squad-public-request': {
    request: ChangeObject<SquadPublicRequest>;
  };
  'api.v1.content-updated': ContentUpdatedMessage;
  'api.v1.user-post-promoted': {
    postId: string;
    userId: string;
    validUntil: string; // ISO 8601 str
  };
  'api.v1.user-streak-updated': {
    streak: ChangeObject<UserStreak>;
  };
  'api.v1.source-post-moderation-approved': {
    post: ChangeObject<SourcePostModeration>;
  };
  'api.v1.source-post-moderation-rejected': {
    post: ChangeObject<SourcePostModeration>;
  };
  'api.v1.source-post-moderation-submitted': {
    post: ChangeObject<SourcePostModeration>;
  };
  'api.v1.post-bookmark-reminder': {
    postId: string;
    userId: string;
  };
  'post-commented': {
    userId: string;
    commentId: string;
    contentHtml: string;
    postId: string;
  };
  'api.v1.post-visible': {
    post: ChangeObject<Post>;
  };
  'api.v1.squad-featured-updated': {
    squad: ChangeObject<SquadSource>;
  };
  'api.v1.user-company-approved': {
    userCompany: ChangeObject<UserCompany>;
  };
  'api.v1.user-top-reader': {
    userTopReader: ChangeObject<UserTopReader>;
  };
  'kvasir.post-translated': {
    id: string;
    language: ContentLanguage;
    translations: PostTranslation;
  };
};

export async function triggerTypedEvent<T extends keyof PubSubSchema>(
  log: EventLogger,
  topic: T,
  data: PubSubSchema[T],
): Promise<void> {
  await publishEvent(log, pubsub.topic(topic), data);
}
