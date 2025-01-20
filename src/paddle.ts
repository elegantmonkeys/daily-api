import { UserSubscriptionFlags } from './entity';

export enum SubscriptionCycles {
  Monthly = 'monthly',
  Yearly = 'yearly',
}

export const isPlusMember = (cycle: SubscriptionCycles | undefined): boolean =>
  !!cycle?.length || false;

export const isGiftedPlus = (
  subscriptionFlags: UserSubscriptionFlags,
): boolean =>
  (!!subscriptionFlags?.gifterId || false) &&
  isPlusMember(subscriptionFlags.cycle);
