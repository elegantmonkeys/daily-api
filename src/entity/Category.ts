import { CategoryKeyword } from './CategoryKeyword';
import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type KeywordStatus = 'pending' | 'allow' | 'deny' | 'synonym';

export enum KEYWORD_CATEGORY {
  'Tech news' = '🦄 Tech news',
  Frontend = '🌈 Frontend',
  Devops = '⚙️ Devops',
  Backend = '☁️ Backend',
  Mobile = '📱 Mobile',
}

export type KeywordCategory = keyof typeof KEYWORD_CATEGORY;

@Entity()
export class Category {
  @PrimaryColumn({ type: 'text' })
  @Index('IDX_category_id')
  id: string;

  @Index()
  @Column({ type: 'text' })
  value: string;

  @Column({ default: () => 'now()' })
  createdAt: Date;

  @UpdateDateColumn()
  @Index('IDX_category_updatedAt')
  updatedAt: Date;

  @OneToMany(() => CategoryKeyword, (ck) => ck.categoryId, {
    lazy: true,
  })
  keywords: Promise<CategoryKeyword[]>;
}
