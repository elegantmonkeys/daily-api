import { Cron } from './cron';
import updateViews from './updateViews';
import checkAnalyticsReport from './checkAnalyticsReport';
import updateTrending from './updateTrending';
import updateTagsStr from './updateTagsStr';
import cleanZombieUsers from './cleanZombieUsers';
import cleanZombieImages from './cleanZombieImages';
import personalizedDigest from './personalizedDigest';
import generateSearchInvites from './generateSearchInvites';
import checkReferralReminder from './checkReferralReminder';
import dailyDigest from './dailyDigest';
import updateHighlightedViews from './updateHighlightedViews';
import hourlyNotifications from './hourlyNotifications';
import updateCurrentStreak from './updateCurrentStreak';
import syncSubscriptionWithCIO from './syncSubscriptionWithCIO';
import validateActiveUsers from './validateActiveUsers';
import { updateSourcePublicThreshold } from './updateSourcePublicThreshold';
import { cleanZombieUserCompany } from './cleanZombieUserCompany';
import { calculateTopReaders } from './calculateTopReaders';
import cleanGiftedPlus from './cleanGiftedPlus';

export const crons: Cron[] = [
  updateViews,
  checkAnalyticsReport,
  updateTrending,
  updateTagsStr,
  cleanZombieUsers,
  cleanZombieImages,
  personalizedDigest,
  generateSearchInvites,
  checkReferralReminder,
  dailyDigest,
  updateHighlightedViews,
  hourlyNotifications,
  updateCurrentStreak,
  syncSubscriptionWithCIO,
  cleanZombieUserCompany,
  updateSourcePublicThreshold,
  calculateTopReaders,
  validateActiveUsers,
  cleanGiftedPlus,
];
