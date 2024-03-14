import { Column, Entity, Index, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from './';
import { DayOfWeek } from '../../types';

export enum UserPersonalizedDigestSendType {
  workdays = 'workdays',
}

export type UserPersonalizedDigestFlags = Partial<{
  sendType: boolean;
}>;

export type UserPersonalizedDigestFlagsPublic = Pick<
  UserPersonalizedDigestFlags,
  'sendType'
>;

@Entity()
export class UserPersonalizedDigest {
  @PrimaryColumn({ type: 'text' })
  userId: string;

  @Column({ type: 'smallint', default: 9 })
  preferredHour: number;

  @Index()
  @Column({ type: 'smallint', default: DayOfWeek.Monday })
  preferredDay = DayOfWeek.Monday;

  @Column({ type: 'text', default: 'Etc/UTC' })
  preferredTimezone: string;

  @Column({ default: 1, nullable: false })
  variation: number;

  @Column({ nullable: true })
  lastSendDate: Date;

  @Column({ type: 'jsonb', default: {} })
  @Index('IDX_user_personalized_digest_flags_sendType', { synchronize: false })
  flags: UserPersonalizedDigestFlags = {};

  @OneToOne(() => User, {
    lazy: true,
    onDelete: 'CASCADE',
  })
  user: Promise<User>;
}
