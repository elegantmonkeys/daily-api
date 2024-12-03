import { Source, SourceType, UserActionType } from '../entity';
import { ContentPreferenceSource } from '../entity/contentPreference/ContentPreferenceSource';
import { SourceMemberRoles } from '../roles';
import { insertOrIgnoreAction } from '../schema/actions';
import { ChangeObject } from '../types';
import { messageToJson, Worker } from './worker';

interface Data {
  source: ChangeObject<Source>;
}

const worker: Worker = {
  subscription: 'api.source-created-squad-user-action',
  handler: async (message, con) => {
    const data: Data = messageToJson(message);

    const { source } = data;

    if (source.type !== SourceType.Squad) {
      return;
    }

    const owner = await con
      .getRepository(ContentPreferenceSource)
      .createQueryBuilder()
      .select('"userId"')
      .where('"referenceId" = :sourceId', { sourceId: source.id })
      .andWhere(`flags->>'role' = :role`, { role: SourceMemberRoles.Admin })
      .orderBy('"createdAt"', 'ASC')
      .getRawOne<Pick<ContentPreferenceSource, 'userId'>>();

    if (!owner) {
      return;
    }

    await insertOrIgnoreAction(con, owner.userId, UserActionType.CreateSquad);
  },
};

export default worker;
