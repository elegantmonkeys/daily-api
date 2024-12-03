import { UserSourceIntegrationSlack } from '../entity/UserSourceIntegration';
import { TypedWorker } from './worker';
import fastq from 'fastq';
import { Post, SourceType } from '../entity';
import {
  getAttachmentForPostType,
  getSlackClient,
} from '../common/userIntegration';
import { addNotificationUtm, addPrivateSourceJoinParams } from '../common';
import { SlackApiError, SlackApiErrorCode } from '../errors';
import { counters } from '../telemetry/metrics';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { SourceMemberRoles } from '../roles';

const sendQueueConcurrency = 10;

export const postAddedSlackChannelSendWorker: TypedWorker<'api.v1.post-visible'> =
  {
    subscription: 'api.post-added-slack-channel-send',
    handler: async (message, con, logger): Promise<void> => {
      const { data } = message;

      try {
        const [post, integrations] = await Promise.all([
          con.getRepository(Post).findOneOrFail({
            where: {
              id: data.post.id,
            },
            relations: {
              source: true,
              author: true,
            },
          }),
          con.getRepository(UserSourceIntegrationSlack).find({
            where: {
              sourceId: data.post.sourceId,
            },
            relations: {
              userIntegration: true,
            },
          }),
        ]);

        if (integrations.length === 0) {
          return;
        }

        if (post.flags?.vordr) {
          return;
        }

        const source = await post.source;
        const sourceTypeName =
          source.type === SourceType.Squad ? 'Squad' : 'source';

        const postLinkPlain = `${process.env.COMMENTS_PREFIX}/posts/${post.id}`;
        const postLinkUrl = new URL(postLinkPlain);
        let postLink = addNotificationUtm(
          postLinkUrl.toString(),
          'slack',
          'new_post',
        );

        if (source.private && source.type === SourceType.Squad) {
          const admin = await con
            .getRepository(ContentPreferenceSource)
            .createQueryBuilder()
            .addSelect('flags')
            .where('"referenceId" = :sourceId', { sourceId: source.id })
            .andWhere(`flags->>'role' = :role`, {
              role: SourceMemberRoles.Admin,
            })
            .orderBy('"createdAt"', 'ASC')
            .getRawOne<Pick<ContentPreferenceSource, 'flags'>>();

          if (admin?.flags.referralToken) {
            postLink = addPrivateSourceJoinParams({
              url: postLink,
              source,
              referralToken: admin.flags.referralToken,
            });
          }
        }

        const author = await post.author;
        const authorName = author?.name || author?.username;
        let messageText = `New post: <${postLink}|${postLinkPlain}>`;

        if (sourceTypeName === 'Squad' && authorName) {
          messageText = `${authorName} shared a new post: <${postLink}|${postLinkPlain}>`;
        }

        const attachment = await getAttachmentForPostType({
          con,
          post,
          postType: data.post.type,
          postLink,
        });

        const sendQueue = fastq.promise(
          async ({
            integration,
            channelId,
          }: {
            integration: UserSourceIntegrationSlack;
            channelId: string;
          }) => {
            const userIntegration = await integration.userIntegration;

            try {
              const slackClient = await getSlackClient({
                integration: userIntegration,
              });

              // channel should already be joined when the integration is connected
              // but just in case
              try {
                await slackClient.conversations.join({
                  channel: channelId,
                });
              } catch (originalJoinError) {
                const conversationsJoinError =
                  originalJoinError as SlackApiError;

                if (
                  ![
                    SlackApiErrorCode.MethodNotSupportedForChannelType,
                  ].includes(
                    conversationsJoinError.data?.error as SlackApiErrorCode,
                  )
                ) {
                  throw originalJoinError;
                }
              }

              await slackClient.chat.postMessage({
                channel: channelId,
                text: messageText,
                attachments: [attachment],
                unfurl_links: false,
              });

              counters?.background?.postSentSlack?.add(1, {
                source: source.id,
              });
            } catch (originalError) {
              const error = originalError as Error;

              logger.error(
                {
                  data: {
                    integrationId: userIntegration.id,
                    sourceId: data.post.sourceId,
                    channelId,
                  },
                  messageId: message.messageId,
                  err: error,
                },
                'failed to send slack message',
              );
            }
          },
          sendQueueConcurrency,
        );

        integrations.forEach((integration) => {
          integration.channelIds.forEach((channelId) => {
            sendQueue.push({ integration, channelId });
          });
        });

        await sendQueue.drained();
      } catch (err) {
        logger.error(
          {
            data,
            messageId: message.messageId,
            err,
          },
          'failed sending to slack channels',
        );
      }
    },
  };
