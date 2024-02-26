import {
  ReputationEvent,
  ReputationReason,
  ReputationType,
  Post,
} from '../entity';
import { messageToJson, Worker } from './worker';
import { In } from 'typeorm';

interface Data {
  userId: string;
  postId: string;
}

const worker: Worker = {
  subscription: 'api.post-downvote-canceled-rep',
  handler: async (message, con, logger): Promise<void> => {
    const data: Data = messageToJson(message);
    try {
      const post = await con.getRepository(Post).findOneBy({ id: data.postId });
      if (!post?.authorId && !post?.scoutId) {
        return;
      }

      const userIds = [];

      if (post?.authorId && post.authorId !== data.userId) {
        userIds.push(post.authorId);
      }

      if (post?.scoutId && post.scoutId !== data.userId) {
        userIds.push(post.scoutId);
      }

      if (userIds.length) {
        await con.getRepository(ReputationEvent).delete({
          grantById: data.userId,
          grantToId: In(userIds),
          targetId: post.id,
          targetType: ReputationType.Post,
          reason: ReputationReason.PostDownvoted,
        });

        logger.info(
          {
            data,
            messageId: message.messageId,
          },
          'increased reputation due to post downvote cancellation',
        );
      }
    } catch (err) {
      logger.error(
        {
          data,
          messageId: message.messageId,
          err,
        },
        'failed to increase reputation due to post downvote cancellation',
      );
    }
  },
};

export default worker;
