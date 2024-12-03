import { expectSuccessfulBackground, saveFixtures } from '../helpers';
import worker from '../../src/workers/sourceSquadCreatedUserAction';
import { DataSource } from 'typeorm';
import createOrGetConnection from '../../src/db';
import {
  SourceType,
  SquadSource,
  User,
  Source,
  UserAction,
  UserActionType,
  Feed,
} from '../../src/entity';
import { SourceMemberRoles } from '../../src/roles';
import { usersFixture } from '../fixture/user';
import { createSource } from '../fixture/source';
import { ContentPreferenceSource } from '../../src/entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../../src/entity/contentPreference/types';

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.resetAllMocks();

  await saveFixtures(con, User, usersFixture);
  await saveFixtures(
    con,
    Feed,
    usersFixture.map((u) => ({ id: u.id, userId: u.id })),
  );
  await con
    .getRepository(SquadSource)
    .save([
      createSource(
        'squadCreatedUA_s1',
        'squadCreatedUA_s1',
        'http://c.com',
        SourceType.Squad,
      ),
    ]);
  await con.getRepository(ContentPreferenceSource).save([
    {
      sourceId: 'squadCreatedUA_s1',
      referenceId: 'squadCreatedUA_s1',
      userId: '2',
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'sourceSquadCreatedUserAction_rt1',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '2',
    },
    {
      sourceId: 'squadCreatedUA_s1',
      referenceId: 'squadCreatedUA_s1',
      userId: '1',
      flags: {
        role: SourceMemberRoles.Admin,
        referralToken: 'sourceSquadCreatedUserAction_rt2',
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: '1',
    },
  ]);
});

describe('sourceSquadCreatedUserAction worker', () => {
  it('should complete create squad user action', async () => {
    const source = await con.getRepository(Source).findOneBy({
      id: 'squadCreatedUA_s1',
    });
    const user = await con.getRepository(User).findOneBy({ id: '2' });

    await expectSuccessfulBackground(worker, {
      source,
    });

    const action = await con.getRepository(UserAction).findOneBy({
      userId: user?.id,
      type: UserActionType.CreateSquad,
    });
    expect(action).toBeTruthy();
  });

  it('should not complete create squad user action if source is not a squad', async () => {
    await con.getRepository(Source).update(
      { id: 'squadCreatedUA_s1' },
      {
        type: SourceType.Machine,
      },
    );
    const source = await con.getRepository(Source).findOneBy({
      id: 'squadCreatedUA_s1',
    });
    const user = await con.getRepository(User).findOneBy({ id: '2' });

    await expectSuccessfulBackground(worker, {
      source,
    });

    const action = await con.getRepository(UserAction).findOneBy({
      userId: user?.id,
      type: UserActionType.CreateSquad,
    });
    expect(action).toBeFalsy();
  });
});
