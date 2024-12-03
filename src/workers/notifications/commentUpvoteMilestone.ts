import { messageToJson } from '../worker';
import { Comment, SourceType } from '../../entity';
import {
  NotificationCommentContext,
  NotificationUpvotersContext,
} from '../../notifications';
import { NotificationType } from '../../notifications/common';
import { NotificationWorker } from './worker';
import { buildPostContext, UPVOTE_MILESTONES } from './utils';
import { SourceMemberRoles } from '../../roles';
import { UserComment } from '../../entity/user/UserComment';
import { UserVote } from '../../types';
import { ContentPreferenceSource } from '../../entity/contentPreference/ContentPreferenceSource';

interface Data {
  userId: string;
  commentId: string;
}

const worker: NotificationWorker = {
  subscription: 'api.comment-upvote-milestone-notification',
  handler: async (message, con) => {
    const data: Data = messageToJson(message);
    const comment = await con
      .getRepository(Comment)
      .findOne({ where: { id: data.commentId } });
    if (
      !comment ||
      comment.userId === data.userId ||
      !UPVOTE_MILESTONES.includes(comment.upvotes.toString())
    ) {
      return;
    }
    const postCtx = await buildPostContext(con, comment.postId);
    if (!postCtx) {
      return;
    }
    const { source } = postCtx;
    const upvotes = await con.getRepository(UserComment).find({
      where: { commentId: comment.id, vote: UserVote.Up },
      take: 5,
      order: { createdAt: 'desc' },
      relations: ['user'],
    });
    const upvoters = await Promise.all(upvotes.map((upvote) => upvote.user));
    const ctx: NotificationCommentContext & NotificationUpvotersContext = {
      ...postCtx,
      comment,
      upvoters,
      upvotes: comment.upvotes,
      userIds: [comment.userId],
    };

    if (source.type === SourceType.Squad) {
      const member = await con
        .getRepository(ContentPreferenceSource)
        .createQueryBuilder()
        .select('"userId"')
        .where('"userId" = :userId', { userId: comment.userId })
        .andWhere('"referenceId" = :sourceId', { sourceId: source.id })
        .andWhere(`flags->>'role' != :role`, {
          role: SourceMemberRoles.Blocked,
        })
        .getRawOne<Pick<ContentPreferenceSource, 'userId'>>();

      if (!member) {
        return;
      }
    }

    return [{ type: NotificationType.CommentUpvoteMilestone, ctx }];
  },
};

export default worker;
