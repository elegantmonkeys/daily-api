import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export enum UserActionType {
  EnableNotification = 'enabled_notification',
}

@Entity()
export class UserAction {
  @Index()
  @PrimaryColumn({ type: 'text' })
  userId: string;

  @PrimaryColumn({ type: 'text' })
  type: UserActionType;

  @Column({ type: 'timestamp without time zone', default: () => 'now()' })
  completedAt: Date;
}
