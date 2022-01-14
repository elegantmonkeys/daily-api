import { Worker } from './worker';
import newView from './newView';
import newPost from './newPost';
import newUser from './newUser';
import updateUser from './updateUser';
import commentUpvoted from './commentUpvoted';
import commentCommented from './commentCommented';
import commentUpvotedRep from './commentUpvotedRep';
import commentFeaturedRep from './commentFeaturedRep';
import commentUpvoteCanceledRep from './commentUpvoteCanceledRep';
import commentCommentedThread from './commentCommentedThread';
import commentFeaturedMail from './commentFeaturedMail';
import postAuthorMatchedMail from './postAuthorMatchedMail';
import commentCommentedAuthor from './commentCommentedAuthor';
import postCommentedAuthor from './postCommentedAuthor';
import commentCommentedSlackMessage from './commentCommentedSlackMessage';
import postCommentedSlackMessage from './postCommentedSlackMessage';
import postUpvotedRep from './postUpvotedRep';
import postUpvoteCanceledRep from './postUpvoteCanceledRep';
import sendAnalyticsReportMail from './sendAnalyticsReportMail';
import postCommentedAuthorTweet from './postCommentedAuthorTweet';
import postReachedViewsThresholdTweet from './postReachedViewsThresholdTweet';
import postCommentedRedis from './postCommentedRedis';
import postUpvotedRedis from './postUpvotedRedis';
import postBannedRep from './postBannedRep';
import postBannedEmail from './postBannedEmail';
import checkDevCardEligibility from './checkDevCardEligibility';
import devCardEligibleAmplitude from './devCardEligibleAmplitude';
import devCardEligibleEmail from './devCardEligibleEmail';
import deleteUser from './deleteUser';
import cdc from './cdc';

export { Worker } from './worker';

export const workers: Worker[] = [
  newView,
  newPost,
  newUser,
  updateUser,
  deleteUser,
  commentUpvoted,
  commentCommented,
  commentUpvotedRep,
  commentFeaturedRep,
  commentUpvoteCanceledRep,
  commentCommentedThread,
  commentFeaturedMail,
  postAuthorMatchedMail,
  commentCommentedAuthor,
  commentCommentedSlackMessage,
  postCommentedSlackMessage,
  postCommentedAuthor,
  postUpvotedRep,
  postUpvoteCanceledRep,
  sendAnalyticsReportMail,
  postCommentedAuthorTweet,
  postReachedViewsThresholdTweet,
  postCommentedRedis,
  postUpvotedRedis,
  postBannedRep,
  postBannedEmail,
  checkDevCardEligibility,
  devCardEligibleAmplitude,
  devCardEligibleEmail,
  cdc,
];
