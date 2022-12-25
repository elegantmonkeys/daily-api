import { NotificationType } from '../entity';
import { NotificationBuilder } from './builder';
import { NotificationIcon } from './icons';
import { scoutArticleLink } from '../common';
import {
  NotificationBaseContext,
  NotificationCommentContext,
  NotificationCommenterContext,
  NotificationDoneByContext,
  NotificationPostContext,
  NotificationSourceContext,
  NotificationSourceRequestContext,
  NotificationSubmissionContext,
  NotificationUpvotersContext,
} from './types';

const systemTitle = () => undefined;

export const notificationTitleMap: Record<
  NotificationType,
  (ctx: NotificationBaseContext) => string | undefined
> = {
  community_picks_failed: systemTitle,
  community_picks_succeeded: () =>
    `<b>Community picks:</b> An article you Scouted was accepted and is now <span class="text-theme-color-cabbage">live</span> on the daily.dev feed!`,
  community_picks_granted: () =>
    `<b>Community picks:</b> You have earned enough reputation to <span class="text-theme-color-cabbage">Scout and submit</span> articles.`,
  article_picked: () =>
    `Congratulations! <b>Your article</b> got <span class="text-theme-color-cabbage">listed</span> on the daily.dev feed!`,
  article_new_comment: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> posted a <span class="text-theme-color-blueCheese">comment</span> on your article.`,
  article_upvote_milestone: (
    ctx: NotificationPostContext & NotificationUpvotersContext,
  ) =>
    `<b>You rock!</b> Your article <span class="text-theme-color-avocado">earned ${ctx.upvotes} upvotes!</span>`,
  article_report_approved: systemTitle,
  article_analytics: systemTitle,
  source_approved: (
    ctx: NotificationSourceRequestContext & NotificationSourceContext,
  ) =>
    `<b>The source you requested was</b> <span class="text-theme-color-cabbage">approved!</span> Articles from ${ctx.source.name} will start appearing in the daily.dev feed in the next few days!`,
  source_rejected: systemTitle,
  comment_mention: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">mentioned you</span> in a comment.`,
  comment_reply: (ctx: NotificationCommenterContext) =>
    `<b>${ctx.commenter.name}</b> <span class="text-theme-color-blueCheese">replied</span> to your comment.`,
  comment_upvote_milestone: (
    ctx: NotificationCommentContext & NotificationUpvotersContext,
  ) =>
    `<b>You rock!</b> Your comment <span class="text-theme-color-avocado">earned ${ctx.upvotes} upvotes!</span>`,
  post_added: (
    ctx: NotificationPostContext & Partial<NotificationDoneByContext>,
  ) => {
    if (ctx.doneBy) {
      return `<b>${ctx.doneBy.name}</b> posted on <b>${ctx.source.name}</b>`;
    }
    return `There is a new post on <b>${ctx.source.name}</b>`;
  },
  post_viewed: (ctx: NotificationDoneByContext) =>
    `<b>${ctx.doneBy.name}</b> viewed your article.`,
  member_joined_source: (
    ctx: NotificationSourceContext & NotificationDoneByContext,
  ) => `<b>${ctx.doneBy.name}</b> joined <b>${ctx.source.name}</b>`,
};

export const generateNotificationMap: Record<
  NotificationType,
  (
    builder: NotificationBuilder,
    ctx: NotificationBaseContext,
  ) => NotificationBuilder
> = {
  community_picks_failed: (builder, ctx: NotificationSubmissionContext) =>
    builder.systemNotification().referenceSubmission(ctx.submission),
  community_picks_succeeded: (builder, ctx: NotificationPostContext) =>
    builder
      .icon(NotificationIcon.CommunityPicks)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost),
  community_picks_granted: (builder) =>
    builder
      .referenceSystem()
      .icon(NotificationIcon.DailyDev)
      .description(`<u>Submit your first article now!</u>`)
      .targetUrl(scoutArticleLink),
  article_picked: (builder, ctx: NotificationPostContext) =>
    builder
      .icon(NotificationIcon.DailyDev)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost),
  article_new_comment: (builder, ctx: NotificationCommenterContext) =>
    builder
      .referenceComment(ctx.comment)
      .icon(NotificationIcon.Comment)
      .descriptionComment(ctx.comment)
      .targetPost(ctx.post, ctx.comment)
      .avatarManyUsers([ctx.commenter]),
  article_upvote_milestone: (
    builder,
    ctx: NotificationPostContext & NotificationUpvotersContext,
  ) =>
    builder
      .objectPost(ctx.post, ctx.source, ctx.sharedPost)
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
  post_added: (
    builder,
    ctx: NotificationPostContext & Partial<NotificationDoneByContext>,
  ) => {
    let newBuilder = builder
      .icon(NotificationIcon.Bell)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost, false)
      .avatarSource(ctx.source);
    if (ctx.doneBy) {
      newBuilder = newBuilder.avatarManyUsers([ctx.doneBy]);
    }
    return newBuilder;
  },
  post_viewed: (
    builder,
    ctx: NotificationPostContext & NotificationDoneByContext,
  ) =>
    builder
      .icon(NotificationIcon.View)
      .objectPost(ctx.post, ctx.source, ctx.sharedPost)
      .avatarManyUsers([ctx.doneBy])
      .uniqueKey(ctx.doneBy.id),
  member_joined_source: (
    builder,
    ctx: NotificationSourceContext & NotificationDoneByContext,
  ) =>
    builder
      .icon(NotificationIcon.Bell)
      .referenceSource(ctx.source)
      .targetSource(ctx.source)
      .avatarSource(ctx.source)
      .avatarManyUsers([ctx.doneBy])
      .uniqueKey(ctx.doneBy.id),
};
