import { templateId } from '../common/mailing';
import { messageToJson, Worker } from './worker';
import { fetchUser } from '../common';
import { baseNotificationEmailData, sendEmail } from '../common';

interface Data {
  userId: string;
}

// TODO:: Update the dynamic template data once available

const worker: Worker = {
  subscription: 'community-link-access-mail',
  handler: async (message, _, logger): Promise<void> => {
    const data: Data = messageToJson(message);
    try {
      const user = await fetchUser(data.userId);
      await sendEmail({
        ...baseNotificationEmailData,
        to: user.email,
        templateId: templateId.communityLinkSubmissionAccess,
        dynamicTemplateData: {
          // status: data.status,
          // url: data.url,
        },
      });
      logger.info(
        { data, messageId: message.messageId },
        'email sent relating to granting access for submitting community links' +
          data.userId,
      );
    } catch (err) {
      logger.error(
        { data, messageId: message.messageId, err },
        'failed to send mail relating to granting access for submitting community links',
      );
    }
  },
};

export default worker;
