import { FreeformPost, KeywordFlags, PostType } from '../entity';
import { NotificationBuilder } from './builder';
import { NotificationIcon } from './icons';
import {
  generateDevCard,
  notificationsLink,
  scoutArticleLink,
  squadsFeaturedPage,
  subscribeNotificationsLink,
} from '../common';
import {
  NotificationBaseContext,
  NotificationBookmarkContext,
  NotificationCollectionContext,
  NotificationCommentContext,
  NotificationCommenterContext,
  NotificationDoneByContext,
  NotificationGiftPlusContext,
  NotificationPostContext,
  NotificationPostModerationContext,
  NotificationSourceContext,
  NotificationSourceMemberRoleContext,
  NotificationSourceRequestContext,
  NotificationSquadRequestContext,
  NotificationStreakContext,
  NotificationSubmissionContext,
  NotificationUpvotersContext,
  NotificationUserContext,
  type NotificationUserTopReaderContext,
} from './types';
import { UPVOTE_TITLES } from '../workers/notifications/utils';
import { checkHasMention } from '../common/markdown';
import { NotificationType } from './common';
import { format } from 'date-fns';
import { rejectReason } from '../entity/SourcePostModeration';

const systemTitle = () => undefined;

const getPostOrSharedPostTitle = (
  ctx: NotificationPostContext,
): string | null | undefined => {
  if (ctx.post?.title?.length) {
    return ctx.post.title;
  }

  if (ctx.sharedPost?.title?.length) {
    return ctx.sharedPost.title;
  }

  return undefined;
};

export const notificationTitleMap: Record<
  NotificationType,
  (ctx: never) => string | undefined
> = {
  community_picks_failed: systemTitle,
  community_picks_succeeded: () =>
    `<b>Community Picks:</b> A link you scouted was accepted and is now <span class="text-theme-color-cabbage">live</span> on the daily.dev feed!`,
  community_picks_granted: () =>
    `<b>Community Picks:</b> You have earned enough reputation to <span class="text-theme-color-cabbage">scout and submit</span> links.`,
  article_picked: () =>
    `Congrats! <b>Your post</b> got <span class="text-theme-color-cabbage">listed</span> on the daily.dev feed!`,
  article_new_comment: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">commented</span> on your post.`,
  article_upvote_milestone: (
    ctx: NotificationPostContext & NotificationUpvotersContext,
  ) =>
    UPVOTE_TITLES[ctx.upvotes as keyof typeof UPVOTE_TITLES] ??
    `<b>You rock!</b> Your post <span class="text-theme-color-avocado">earned ${ctx.upvotes} upvotes!</span>`,
  article_report_approved: systemTitle,
  article_analytics: systemTitle,
  source_approved: (
    ctx: NotificationSourceRequestContext & NotificationSourceContext,
  ) =>
    `<b>The source you suggested was</b> <span class="text-theme-color-cabbage">approved!</span> Posts from ${ctx.source.name} will start appearing in the daily.dev feed in the next few days!`,
  source_rejected: systemTitle,
  comment_mention: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">mentioned you</span> in a comment.`,
  comment_reply: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">replied</span> to your comment.`,
  comment_upvote_milestone: (
    ctx: NotificationCommentContext & NotificationUpvotersContext,
  ) =>
    UPVOTE_TITLES[ctx.upvotes as keyof typeof UPVOTE_TITLES] ??
    `<b>You rock!</b> Your comment <span class="text-theme-color-avocado">earned ${ctx.upvotes} upvotes!</span>`,
  squad_post_added: (
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) =>
    `<b>${ctx.doneBy.name}</b> shared a new post on <b>${ctx.source.name}</b>`,
  squad_member_joined: (
    ctx: NotificationSourceContext & NotificationDoneByContext,
  ) =>
    `Your squad <b>${ctx.source.name}</b> is <span class="text-theme-color-cabbage">growing</span>! Welcome <b>${ctx.doneBy.name}</b> to the squad with a comment.`,
  squad_new_comment: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">commented</span> on your post on <b>${ctx.source.name}</b>.`,
  squad_reply: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">replied</span> to your comment on <b>${ctx.source.name}</b>.`,
  squad_blocked: (ctx: NotificationSourceContext) =>
    `You are no longer part of <b>${ctx.source.name}</b>`,
  squad_featured: (ctx: NotificationSourceContext) =>
    `Congratulations! <b>${ctx.source.name}</b> is now officially featured on the Squads directory`,
  squad_subscribe_to_notification: (ctx: NotificationSourceContext) =>
    `Congrats on your first post on <b>${ctx.source.name}</b>. Subscribe to get updates about activity in your squad.`,
  promoted_to_admin: (ctx: NotificationSourceContext) =>
    `Congratulations! You are now an <span class="text-theme-color-cabbage">admin</span> of <b>${ctx.source.name}</b>`,
  demoted_to_member: (ctx: NotificationSourceMemberRoleContext) =>
    `You are no longer a <span class="text-theme-color-cabbage">${ctx.role}</span> in <b>${ctx.source.name}</b>`,
  promoted_to_moderator: (ctx: NotificationSourceContext) =>
    `You are now a <span class="text-theme-color-cabbage">moderator</span> in <b>${ctx.source.name}</b>`,
  post_mention: (ctx: NotificationPostContext & NotificationDoneByContext) =>
    `<b>${ctx.doneBy.username}</b> <span class="text-theme-color-cabbage">mentioned you</span> on a post in <b>${ctx.source.name}</b>.`,
  collection_updated: (ctx: NotificationPostContext) =>
    `The collection "<b>${ctx.post.title}</b>" just got updated with new details`,
  dev_card_unlocked: () => 'DevCard unlocked!',
  post_bookmark_reminder: (ctx: NotificationPostContext) =>
    `Reading reminder! <b>${getPostOrSharedPostTitle(ctx)}</b>`,
  source_post_added: (
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) => `New post from <b>${ctx.source.name}</b>, check it out now!`,
  squad_public_approved: (
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) =>
    `<b>Congratulations! ${ctx.source.name} has successfully passed the review process and is now officially public!</b>`,
  squad_public_rejected: systemTitle,
  squad_public_submitted: systemTitle,
  streak_reset_restore: (ctx: NotificationStreakContext) =>
    `<b>Oh no! Your ${ctx.streak.currentStreak} day streak has been broken</b>`,
  user_post_added: (ctx: NotificationUserContext) => {
    const userName = ctx.user.name || ctx.user.username;

    return `New post from <b>${userName}</b>, check it out now!`;
  },
  user_given_top_reader: (ctx: NotificationUserTopReaderContext) => {
    const keyword =
      (ctx.keyword.flags as KeywordFlags)?.title || ctx.keyword.value;
    return `Great news! You've earned the top reader badge in ${keyword}.`;
  },
  source_post_approved: (ctx: NotificationPostContext) =>
    `Woohoo! Your post has been approved and is now live in ${ctx.source.name}. Check it out!`,
  source_post_rejected: (ctx: NotificationPostModerationContext) => {
    const reason = ctx.post.rejectionReason
      ? rejectReason[ctx.post.rejectionReason]
      : rejectReason.OTHER;
    return `Your post in ${ctx.source.name} was not approved for the following reason: ${reason}. Please review the feedback and consider making changes before resubmitting.`;
  },
  source_post_submitted: (ctx: NotificationPostModerationContext) =>
    `${ctx.user.name} just posted in ${ctx.source.name}. This post is waiting for your review before it gets published on the squad.`,
  user_gifted_plus: (ctx: NotificationGiftPlusContext) =>
    `Surprise! 🎁 ${ctx.gifter.username} thought of you and gifted you a one-year daily.dev Plus membership! How’s that for a thoughtful surprise?`,
};

export const generateNotificationMap: Record<
  NotificationType,
  (builder: NotificationBuilder, ctx: never) => NotificationBuilder
> = {
  user_given_top_reader: (builder, ctx: NotificationUserTopReaderContext) =>
    builder
      .icon(NotificationIcon.TopReaderBadge)
      .referenceUserTopReader(ctx.userTopReader)
      .targetUrl(notificationsLink)
      .setTargetUrlParameter([
        ['topreader', 'true'],
        ['badgeId', ctx.userTopReader.id],
      ])
      .avatarTopReaderBadge(ctx)
      .uniqueKey(ctx.userIds[0]),
  source_post_approved: (builder, ctx: NotificationPostContext) =>
    builder
      .icon(NotificationIcon.Bell)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost)
      .uniqueKey(ctx.moderated?.id ?? ctx.post.id),
  source_post_rejected: (builder, ctx: NotificationPostModerationContext) =>
    builder
      .icon(NotificationIcon.Bell)
      .referencePostModeration(ctx.post)
      .targetSourceModeration(ctx.source)
      .description(ctx.post.moderatorMessage ?? '')
      .avatarSource(ctx.source),
  source_post_submitted: (builder, ctx: NotificationPostModerationContext) =>
    builder
      .icon(NotificationIcon.Timer)
      .avatarSource(ctx.source)
      .avatarUser(ctx.user)
      .referencePostModeration(ctx.post)
      .targetSourceModeration(ctx.source),
  community_picks_failed: (builder, ctx: NotificationSubmissionContext) =>
    builder.systemNotification().referenceSubmission(ctx.submission),
  community_picks_succeeded: (builder, ctx: NotificationPostContext) =>
    builder
      .icon(NotificationIcon.CommunityPicks)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!),
  community_picks_granted: (builder) =>
    builder
      .referenceSystem()
      .icon(NotificationIcon.DailyDev)
      .description(`<u>Submit your first post now!</u>`)
      .targetUrl(scoutArticleLink),
  article_picked: (builder, ctx: NotificationPostContext) =>
    builder
      .icon(NotificationIcon.DailyDev)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!),
  article_new_comment: (builder, ctx: NotificationCommenterContext) =>
    builder
      .referenceComment(ctx.comment)
      .icon(NotificationIcon.Comment)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment)
      .avatarManyUsers([ctx.commenter]),
  post_bookmark_reminder: (
    builder,
    ctx: NotificationPostContext & NotificationBookmarkContext,
  ) =>
    builder
      .icon(NotificationIcon.BookmarkReminder)
      .referencePost(ctx.post)
      .targetPost(ctx.post)
      .avatarSource(ctx.source)
      .uniqueKey(ctx.bookmark.remindAt.toString())
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!),
  streak_reset_restore: (builder, ctx: NotificationStreakContext) =>
    builder
      .icon(NotificationIcon.Streak)
      .description('Click here if you wish to restore your streak')
      .uniqueKey(format(ctx.streak.lastViewAt!, 'dd-MM-yyyy'))
      .targetUrl(notificationsLink)
      .referenceStreak(ctx.streak)
      .setTargetUrlParameter([
        ['streak_restore', ctx.streak.currentStreak.toString()],
      ]),
  article_upvote_milestone: (
    builder,
    ctx: NotificationPostContext & NotificationUpvotersContext,
  ) =>
    builder
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!)
      .upvotes(ctx.upvotes, ctx.upvoters),
  article_report_approved: (builder, ctx: NotificationPostContext) =>
    builder.referencePost(ctx.post).systemNotification(),
  article_analytics: (builder, ctx: NotificationPostContext) =>
    builder.referencePost(ctx.post).systemNotification(),
  source_approved: (
    builder,
    ctx: NotificationSourceRequestContext & NotificationSourceContext,
  ) =>
    builder
      .referenceSourceRequest(ctx.sourceRequest)
      .icon(NotificationIcon.DailyDev)
      .targetSource(ctx.source)
      .avatarSource(ctx.source),
  source_rejected: (builder, ctx: NotificationSourceRequestContext) =>
    builder.systemNotification().referenceSourceRequest(ctx.sourceRequest),
  comment_mention: (builder, ctx: NotificationCommenterContext) =>
    builder
      .referenceComment(ctx.comment)
      .icon(NotificationIcon.Comment)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment)
      .avatarManyUsers([ctx.commenter]),
  post_mention: (
    builder,
    ctx: NotificationPostContext<FreeformPost> & NotificationDoneByContext,
  ) =>
    builder
      .referencePost(ctx.post)
      .icon(NotificationIcon.Comment)
      .description(
        checkHasMention(ctx.post.title ?? '', ctx.doneTo?.username ?? '')
          ? ctx.post.title!
          : ctx.post.content,
        true,
      )
      .targetPost(ctx.post)
      .avatarManyUsers([ctx.doneBy]),
  comment_reply: (builder, ctx: NotificationCommenterContext) =>
    builder
      .referenceComment(ctx.comment)
      .icon(NotificationIcon.Comment)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment)
      .avatarManyUsers([ctx.commenter]),
  comment_upvote_milestone: (
    builder,
    ctx: NotificationCommentContext & NotificationUpvotersContext,
  ) =>
    builder
      .referenceComment(ctx.comment)
      .upvotes(ctx.upvotes, ctx.upvoters)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment),
  squad_post_added: (
    builder,
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) =>
    builder
      .icon(NotificationIcon.Bell)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!)
      .avatarManyUsers([ctx.doneBy]),
  squad_member_joined: (
    builder,
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) =>
    builder
      .icon(NotificationIcon.Bell)
      .referencePost(ctx.post)
      .targetPost(ctx.post)
      .avatarSource(ctx.source)
      .avatarManyUsers([ctx.doneBy])
      .uniqueKey(ctx.doneBy.id)
      .setTargetUrlParameter(
        ctx.post.type === PostType.Welcome
          ? [
              [
                'comment',
                `@${ctx.doneBy.username} welcome to ${ctx.source.name}!`,
              ],
            ]
          : [],
      ),
  squad_new_comment: (builder, ctx: NotificationCommenterContext) =>
    builder
      .referenceComment(ctx.comment)
      .icon(NotificationIcon.Comment)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment)
      .avatarSource(ctx.source)
      .avatarManyUsers([ctx.commenter]),
  squad_reply: (builder, ctx: NotificationCommenterContext) =>
    builder
      .referenceComment(ctx.comment)
      .icon(NotificationIcon.Comment)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment)
      .avatarSource(ctx.source)
      .avatarManyUsers([ctx.commenter]),
  squad_blocked: (builder, ctx: NotificationSourceContext) =>
    builder
      .targetUrl(process.env.COMMENTS_PREFIX)
      .avatarSource(ctx.source)
      .icon(NotificationIcon.Block)
      .referenceSource(ctx.source)
      .uniqueKey(ctx.userIds[0]),
  squad_featured: (builder, ctx: NotificationSourceContext) =>
    builder
      .targetUrl(squadsFeaturedPage)
      .avatarSource(ctx.source)
      .icon(NotificationIcon.Bell)
      .referenceSource(ctx.source)
      .uniqueKey(format(new Date(), 'dd-MM-yyyy')),
  squad_subscribe_to_notification: (builder, ctx: NotificationSourceContext) =>
    builder
      .targetUrl(subscribeNotificationsLink)
      .avatarSource(ctx.source)
      .icon(NotificationIcon.Bell)
      .referenceSource(ctx.source)
      .uniqueKey(ctx.userIds[0]),
  promoted_to_admin: (builder, ctx: NotificationSourceContext) =>
    builder
      .avatarSource(ctx.source)
      .icon(NotificationIcon.Star)
      .referenceSource(ctx.source)
      .targetUrl(notificationsLink)
      .setTargetUrlParameter([
        ['promoted', 'true'],
        ['sid', ctx.source.handle],
      ])
      .uniqueKey(ctx.userIds[0]),
  demoted_to_member: (builder, ctx: NotificationSourceMemberRoleContext) =>
    builder
      .avatarSource(ctx.source)
      .sourceMemberRole(ctx.role)
      .referenceSource(ctx.source)
      .targetSource(ctx.source)
      .uniqueKey(ctx.userIds[0]),
  promoted_to_moderator: (builder, ctx: NotificationSourceContext) =>
    builder
      .avatarSource(ctx.source)
      .icon(NotificationIcon.User)
      .referenceSource(ctx.source)
      .targetUrl(notificationsLink)
      .setTargetUrlParameter([
        ['promoted', 'true'],
        ['sid', ctx.source.handle],
      ])
      .uniqueKey(ctx.userIds[0]),
  collection_updated: (builder, ctx: NotificationCollectionContext) =>
    builder
      .icon(NotificationIcon.Bell)
      .referencePost(ctx.post)
      .targetPost(ctx.post)
      .avatarManySources(ctx.sources)
      .numTotalAvatars(ctx.total)
      .uniqueKey(ctx.post.metadataChangedAt?.toString()),
  dev_card_unlocked: (builder, ctx: NotificationBaseContext) =>
    builder
      .referenceSystem()
      .icon(NotificationIcon.DevCard)
      .description(
        'You can now generate your own DevCard to showcase your daily.dev achievements.',
      )
      .targetUrl(generateDevCard)
      .uniqueKey(ctx.userIds[0]),
  source_post_added: (
    builder,
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) =>
    builder
      .icon(NotificationIcon.Bell)
      .avatarSource(ctx.source)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!),
  squad_public_approved: (
    builder: NotificationBuilder,
    ctx: NotificationSquadRequestContext & NotificationSourceContext,
  ) =>
    builder
      .icon(NotificationIcon.DailyDev)
      .referenceSquadRequest(ctx.squadRequest)
      .targetSource(ctx.source)
      .avatarSource(ctx.source),
  squad_public_rejected: (
    builder: NotificationBuilder,
    ctx: NotificationSquadRequestContext & NotificationSourceContext,
  ) => builder.systemNotification().referenceSquadRequest(ctx.squadRequest),
  squad_public_submitted: (
    builder: NotificationBuilder,
    ctx: NotificationSquadRequestContext & NotificationSourceContext,
  ) => builder.systemNotification().referenceSquadRequest(ctx.squadRequest),
  user_post_added: (
    builder,
    ctx: NotificationUserContext & NotificationPostContext,
  ) =>
    builder
      .icon(NotificationIcon.Bell)
      .avatarUser(ctx.user)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost!),
  user_gifted_plus: (builder, ctx: NotificationGiftPlusContext) =>
    builder
      .uniqueKey(
        `${ctx.gifter.id}-${ctx.recipient.id}-${ctx.subscriptionFlags.giftExpirationDate}`,
      )
      .icon(NotificationIcon.Bell)
      .avatarUser(ctx.gifter)
      .referenceSource(ctx.squad),
};
