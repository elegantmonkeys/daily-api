import {
  Bookmark,
  Comment,
  NotificationAttachmentV2,
  NotificationAvatarV2,
  NotificationV2,
  Post,
  Source,
  SourceRequest,
  SquadPublicRequest,
  Submission,
  User,
  UserStreak,
  type Keyword,
  type UserTopReader,
  type UserSubscriptionFlags,
  SquadSource,
} from '../entity';
import { ChangeObject } from '../types';
import { DeepPartial } from 'typeorm';
import { SourceMemberRoles } from '../roles';
import { SourcePostModeration } from '../entity/SourcePostModeration';

export type Reference<T> = ChangeObject<T> | T;

export type NotificationBundleV2 = {
  notification: DeepPartial<NotificationV2>;
  userIds: string[];
  avatars?: DeepPartial<NotificationAvatarV2>[];
  attachments?: DeepPartial<NotificationAttachmentV2>[];
};

export type NotificationBaseContext = {
  userIds: string[];
  initiatorId?: string | null;
};
export type NotificationSubmissionContext = NotificationBaseContext & {
  submission: Pick<Submission, 'id'>;
};

export type NotificationSourceContext = NotificationBaseContext & {
  source: Reference<Source>;
};

export type NotificationPostModerationContext = NotificationUserContext &
  NotificationBaseContext &
  NotificationSourceContext & {
    post: Reference<SourcePostModeration>;
  };

export type NotificationPostContext<T extends Post = Post> =
  NotificationBaseContext &
    NotificationSourceContext & {
      post: Reference<T>;
      sharedPost?: Reference<Post> | null;
      moderated?: Reference<SourcePostModeration>;
    };

export type NotificationCommentContext = NotificationPostContext & {
  comment: Reference<Comment>;
};

export type NotificationBookmarkContext = NotificationBaseContext & {
  bookmark: Reference<Bookmark>;
};

export type NotificationStreakContext = NotificationBaseContext & {
  streak: Omit<Reference<UserStreak>, 'lastViewAt'> & {
    lastViewAt: number;
  };
};

export type NotificationGiftPlusContext = NotificationBaseContext & {
  gifter: Reference<User>;
  recipient: Reference<User>;
  squad: Reference<SquadSource>;
  subscriptionFlags: UserSubscriptionFlags;
};

export type NotificationCommenterContext = NotificationCommentContext & {
  commenter: Reference<User>;
};

export type NotificationUpvotersContext = NotificationBaseContext & {
  upvotes: number;
  upvoters: Reference<User>[];
};

export type NotificationSourceRequestContext = NotificationBaseContext & {
  sourceRequest: Reference<SourceRequest>;
};

export type NotificationSquadRequestContext = NotificationBaseContext & {
  squadRequest: Reference<SquadPublicRequest>;
};

export type NotificationDoneByContext = NotificationBaseContext & {
  doneBy: Reference<User>;
  doneTo?: Reference<User>;
};

export type NotificationSourceMemberRoleContext = NotificationSourceContext & {
  role: Reference<SourceMemberRoles>;
};

export type NotificationCollectionContext = NotificationPostContext & {
  sources: Reference<Source>[];
  total: number;
};

export type NotificationUserContext = NotificationBaseContext & {
  user: Reference<User>;
};

export type NotificationUserTopReaderContext = NotificationBaseContext & {
  userTopReader: Reference<UserTopReader>;
  keyword: Reference<Keyword>;
};
