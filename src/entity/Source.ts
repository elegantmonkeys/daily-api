import {
  ChildEntity,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  TableInheritance,
} from 'typeorm';
import { SourceDisplay } from './SourceDisplay';
import { SourceFeed } from './SourceFeed';
import { Post } from './posts';
import { SourceMember } from './SourceMember';

export const COMMUNITY_PICKS_SOURCE = 'community';

@Entity()
@TableInheritance({
  column: { type: 'varchar', name: 'type', default: 'machine' },
})
export class Source {
  @PrimaryColumn({ type: 'text' })
  id: string;

  type: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  image?: string;

  @Column({ default: false })
  private: boolean;

  @OneToMany(() => SourceDisplay, (display) => display.source, { lazy: true })
  displays: Promise<SourceDisplay[]>;

  @OneToMany(() => SourceFeed, (feed) => feed.source, { lazy: true })
  feeds: Promise<SourceFeed[]>;

  @OneToMany(() => Post, (post) => post.source, { lazy: true })
  posts: Promise<Post[]>;

  @OneToMany(() => SourceMember, (sm) => sm.source, { lazy: true })
  members: Promise<SourceMember[]>;
}

@ChildEntity('machine')
export class MachineSource extends Source {
  @Column({ type: 'text', nullable: true })
  twitter?: string;

  @Column({ type: 'text', nullable: true })
  website?: string;

  @Column({ default: 0 })
  rankBoost: number;

  @Column({ type: 'int', array: true, default: [] })
  @Index('IDX_source_advancedSettings')
  advancedSettings: number[];
}

@ChildEntity('squad')
export class SquadSource extends Source {
  @Column({ length: 36, nullable: true })
  @Index('IDX_source_handle', { unique: true })
  handle: string;

  @Column({ type: 'text', nullable: true })
  description?: string;
}
