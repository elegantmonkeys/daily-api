import {
  AfterLoad,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { DayOfWeek, DEFAULT_TIMEZONE, DEFAULT_WEEK_START } from '../../common';
import { ContentLanguage } from '../../types';
import type { Post } from '../posts';
import type { DevCard } from '../DevCard';
import type { UserStreak } from './UserStreak';
import type { UserStreakAction } from './UserStreakAction';
import type { UserCompany } from '../UserCompany';
import type { UserTopReader } from './UserTopReader';
import type { SubscriptionCycles } from '../../paddle';
import type { Feed } from '../Feed';

export type UserFlags = Partial<{
  vordr: boolean;
  trustScore: number;
}>;

export type UserSubscriptionFlags = Partial<{
  cycle: SubscriptionCycles;
  createdAt: Date;
  subscriptionId: string;
  gifterId: string;
  giftExpirationDate: Date;
}>;

@Entity()
@Index('IDX_user_lowerusername_username', { synchronize: false })
@Index('IDX_user_lowertwitter', { synchronize: false })
@Index('IDX_user_loweremail', { synchronize: false })
@Index('IDX_user_gin_username', { synchronize: false })
@Index('IDX_user_gin_name', { synchronize: false })
@Index('IDX_user_reputation', { synchronize: false })
@Index('IDX_user_subflags_subscriptionid', { synchronize: false })
export class User {
  @PrimaryColumn({ length: 36 })
  id: string;

  @Column({ type: 'text', nullable: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  @Index('IDX_user_email')
  email: string;

  @Column({ type: 'text', nullable: true })
  image?: string | null;

  @Column({ type: 'text', nullable: true })
  cover?: string | null;

  @Column({ type: 'text', nullable: true })
  company?: string;

  @Column({ type: 'text', nullable: true })
  title?: string;

  @Column({ default: false })
  infoConfirmed: boolean;

  @Column({ default: false })
  acceptedMarketing: boolean;

  @Column({ default: true })
  notificationEmail: boolean;

  @Column({ default: 10 })
  reputation: number;

  @Column({ length: 39, nullable: true })
  @Index('users_username_unique', { unique: true })
  username?: string;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ length: 15, nullable: true })
  @Index('users_twitter_unique', { unique: true })
  twitter?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_github_unique', { unique: true })
  github?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_roadmap_unique', { unique: true })
  roadmap?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_threads_unique', { unique: true })
  threads?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_codepen_unique', { unique: true })
  codepen?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_reddit_unique', { unique: true })
  reddit?: string;

  @Column({ length: 100, nullable: true })
  @Index('users_stackoverflow_unique', { unique: true })
  stackoverflow?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_youtube_unique', { unique: true })
  youtube?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_linkedin_unique', { unique: true })
  linkedin?: string;

  @Column({ length: 100, nullable: true })
  @Index('users_mastodon_unique', { unique: true })
  mastodon?: string;

  @Column({ length: 100, nullable: true })
  @Index('users_bluesky_unique', { unique: true })
  bluesky?: string;

  @Column({ type: 'text', nullable: true })
  portfolio?: string;

  @Column({ length: 39, nullable: true })
  @Index('users_hashnode_unique', { unique: true })
  hashnode?: string;

  @Column({ default: false })
  devcardEligible: boolean;

  @Column({ default: true })
  cioRegistered: boolean;

  @Column({ type: 'text', nullable: true, default: DEFAULT_TIMEZONE })
  timezone?: string;

  @Column({ type: 'int', nullable: true, default: DEFAULT_WEEK_START })
  weekStart: DayOfWeek;

  @Column({ type: 'boolean', default: false })
  profileConfirmed: boolean | null;

  @Column({ nullable: false, default: () => 'now()' })
  @Index('IDX_user_createdAt')
  createdAt: Date;

  @Column({ nullable: true })
  updatedAt?: Date;

  @Column({ length: 36, nullable: true })
  @Index('IDX_user_referral')
  referralId?: string | null;

  @Column({ type: 'text', nullable: true })
  @Index('IDX_user_referral_origin')
  referralOrigin?: string | null;

  @Column({ type: 'text', nullable: true })
  readme?: string;

  @Column({ type: 'text', nullable: true })
  readmeHtml?: string;

  @Column({ type: 'text', nullable: true })
  acquisitionChannel: string;

  @Column({ type: 'text', nullable: true })
  experienceLevel: string | null;

  @Column({ type: 'jsonb', default: {} })
  flags: UserFlags;

  @Column({ type: 'text', nullable: true })
  language: ContentLanguage | null;

  @Column({ type: 'boolean', default: true })
  followingEmail: boolean;

  @Column({ type: 'boolean', default: true })
  followNotifications: boolean;

  @Column({ type: 'text', nullable: true })
  defaultFeedId?: string | null;

  @ManyToOne(() => User, {
    lazy: true,
    onDelete: 'SET NULL',
  })
  referral?: Promise<User>;

  @Column({ type: 'jsonb', default: {} })
  subscriptionFlags?: UserSubscriptionFlags;

  @OneToMany('Post', (post: Post) => post.author, { lazy: true })
  posts: Promise<Post[]>;

  @OneToMany('DevCard', (devcard: DevCard) => devcard.user, { lazy: true })
  devCards: Promise<DevCard[]>;

  @OneToMany('UserStreakAction', (action: UserStreakAction) => action.user, {
    lazy: true,
  })
  streakActions: Promise<UserStreakAction[]>;

  @OneToMany('UserCompany', (userCompany: UserCompany) => userCompany.user, {
    lazy: true,
  })
  userCompanies: Promise<UserCompany[]>;

  @OneToOne('Feed', {
    lazy: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'defaultFeedId' })
  defaultFeed?: Promise<Feed>;

  @OneToMany(
    'UserTopReader',
    (userTopReader: UserTopReader) => userTopReader.user,
    {
      lazy: true,
    },
  )
  userTopReaders: Promise<UserTopReader[]>;

  @OneToOne('UserStreak', (streak: UserStreak) => streak.user, {
    lazy: true,
    onDelete: 'SET NULL',
  })
  streak: Promise<UserStreak>;

  permalink: string;

  @AfterLoad()
  setComputed() {
    this.permalink = `${process.env.COMMENTS_PREFIX}/${
      this.username ?? this.id
    }`;
  }
}
