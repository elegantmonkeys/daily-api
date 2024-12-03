import nock from 'nock';
import worker from '../../src/workers/userUpdatedPlusSubscription';
import { ChangeObject } from '../../src/types';
import { expectSuccessfulTypedBackground, saveFixtures } from '../helpers';
import { User, Source, Feed } from '../../src/entity';
import { ghostUser, PubSubSchema } from '../../src/common';
import { typedWorkers } from '../../src/workers';
import createOrGetConnection from '../../src/db';
import { DataSource, Not } from 'typeorm';
import { usersFixture } from '../fixture/user';
import { SourceMemberRoles } from '../../src/roles';
import { randomUUID } from 'crypto';
import { ContentPreferenceSource } from '../../src/entity/contentPreference/ContentPreferenceSource';
import { ContentPreferenceStatus } from '../../src/entity/contentPreference/types';

const PLUS_MEMBER_SQUAD_ID = '05862288-bace-4723-9218-d30fab6ae96d';

jest.mock('../../src/common', () => ({
  ...jest.requireActual('../../src/common'),
  getShortGenericInviteLink: jest.fn(),
  resubscribeUser: jest.fn(),
}));

jest.mock('../../src/cio', () => ({
  ...(jest.requireActual('../../src/cio') as Record<string, unknown>),
  cio: { identify: jest.fn() },
}));

beforeEach(async () => {
  await con.getRepository(Source).save({
    id: PLUS_MEMBER_SQUAD_ID,
    type: 'squad',
    name: 'plus',
    handle: 'plus',
  });
  await saveFixtures(con, User, usersFixture);
  await con.getRepository(Feed).save({
    id: '1',
    userId: '1',
  });
  jest.clearAllMocks();
  nock.cleanAll();
});

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

describe('userUpdatedPlusSubscription', () => {
  type ObjectType = Partial<User>;
  const base: ChangeObject<ObjectType> = {
    id: '1',
    username: 'cio',
    name: 'Customer IO',
    infoConfirmed: true,
    createdAt: 1714577744717000,
    updatedAt: 1714577744717000,
    bio: 'bio',
    readme: 'readme',
    notificationEmail: true,
    acceptedMarketing: true,
    followingEmail: true,
    subscriptionFlags: JSON.stringify({}),
  };

  it('should be registered', () => {
    const registeredWorker = typedWorkers.find(
      (item) => item.subscription === worker.subscription,
    );

    expect(registeredWorker).toBeDefined();
  });

  it('should add user to squad', async () => {
    const newBase = {
      ...base,
      subscriptionFlags: JSON.stringify({ subscriptionId: '1234' }),
    };
    await expectSuccessfulTypedBackground(worker, {
      newProfile: newBase,
      user: base,
    } as unknown as PubSubSchema['user-updated']);
    const sourceMember = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        referenceId: PLUS_MEMBER_SQUAD_ID,
        userId: newBase.id,
        status: Not(ContentPreferenceStatus.Blocked),
      });
    expect(sourceMember?.flags.role).toEqual(SourceMemberRoles.Member);
    expect(sourceMember?.referenceId).toEqual(PLUS_MEMBER_SQUAD_ID);
    expect(sourceMember?.userId).toEqual(newBase.id);
  });

  it('should not add user if user is ghost user', async () => {
    const before: ChangeObject<ObjectType> = { ...base, id: ghostUser.id };
    await expectSuccessfulTypedBackground(worker, {
      newProfile: before,
      user: before,
    } as unknown as PubSubSchema['user-updated']);
    const sourceMember = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        referenceId: PLUS_MEMBER_SQUAD_ID,
        userId: base.id,
        status: Not(ContentPreferenceStatus.Blocked),
      });
    expect(sourceMember).toEqual(null);
  });

  it('should not add user if user is not confirmed', async () => {
    const before: ChangeObject<ObjectType> = { ...base, infoConfirmed: false };
    await expectSuccessfulTypedBackground(worker, {
      newProfile: before,
      user: before,
    } as unknown as PubSubSchema['user-updated']);
    const sourceMember = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        referenceId: PLUS_MEMBER_SQUAD_ID,
        userId: base.id,
        status: Not(ContentPreferenceStatus.Blocked),
      });
    expect(sourceMember).toEqual(null);
  });

  it('should not add user if flags empty', async () => {
    const before: ChangeObject<ObjectType> = { ...base, flags: '{}' };
    await expectSuccessfulTypedBackground(worker, {
      newProfile: before,
      user: before,
    } as unknown as PubSubSchema['user-updated']);
    const sourceMember = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        referenceId: PLUS_MEMBER_SQUAD_ID,
        userId: base.id,
        status: Not(ContentPreferenceStatus.Blocked),
      });
    expect(sourceMember).toEqual(null);
  });

  it('should not add user if flags the same', async () => {
    const before: ChangeObject<ObjectType> = {
      ...base,
      flags: '{subscriptionId: "1234"}',
    };
    await expectSuccessfulTypedBackground(worker, {
      newProfile: before,
      user: before,
    } as unknown as PubSubSchema['user-updated']);
    const sourceMember = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        referenceId: PLUS_MEMBER_SQUAD_ID,
        userId: base.id,
        status: Not(ContentPreferenceStatus.Blocked),
      });
    expect(sourceMember).toEqual(null);
  });

  it('should remove user from squad', async () => {
    await con.getRepository(ContentPreferenceSource).save({
      sourceId: PLUS_MEMBER_SQUAD_ID,
      referenceId: PLUS_MEMBER_SQUAD_ID,
      userId: base.id,
      flags: {
        role: SourceMemberRoles.Member,
        referralToken: randomUUID(),
      },
      status: ContentPreferenceStatus.Subscribed,
      feedId: base.id,
    });
    const oldBase = {
      ...base,
      subscriptionFlags: JSON.stringify({ subscriptionId: '1234' }),
    };
    await expectSuccessfulTypedBackground(worker, {
      newProfile: base,
      user: oldBase,
    } as unknown as PubSubSchema['user-updated']);

    const sourceMember = await con
      .getRepository(ContentPreferenceSource)
      .findOneBy({
        referenceId: PLUS_MEMBER_SQUAD_ID,
        userId: base.id,
        status: Not(ContentPreferenceStatus.Blocked),
      });
    expect(sourceMember).toEqual(null);
  });
});
