import type { Guide } from '@/content/guides/types';

import { aiSocialMediaPostGenerator } from '@/content/guides/ai-social-media-post-generator';
import { bestSocialMediaSchedulingTools } from '@/content/guides/best-social-media-scheduling-tools';
import { bestTimeToPostOnInstagramUk } from '@/content/guides/best-time-to-post-on-instagram-uk';
import { cafeSocialMediaIdeas } from '@/content/guides/cafe-social-media-ideas';
import { christmasMarketingIdeasForPubsAndRestaurants } from '@/content/guides/christmas-marketing-ideas-for-pubs-and-restaurants';
import { coffeeCaptionsAndQuotes } from '@/content/guides/coffee-captions-and-quotes';
import { foodAndDrinkCaptionsForInstagram } from '@/content/guides/food-and-drink-captions-for-instagram';
import { hashtagsForCafesPubsAndRestaurants } from '@/content/guides/hashtags-for-cafes-pubs-and-restaurants';
import { hotelSocialMediaIdeas } from '@/content/guides/hotel-social-media-ideas';
import { howToPromoteAnEventOnFacebook } from '@/content/guides/how-to-promote-an-event-on-facebook';
import { howToReplyToReviews } from '@/content/guides/how-to-reply-to-reviews';
import { howToScheduleFacebookPosts } from '@/content/guides/how-to-schedule-facebook-posts';
import { howToScheduleInstagramPosts } from '@/content/guides/how-to-schedule-instagram-posts';
import { howToTakeFoodPhotosWithYourPhone } from '@/content/guides/how-to-take-food-photos-with-your-phone';
import { linkInBioForVenues } from '@/content/guides/link-in-bio-for-venues';
import { pubEventIdeas } from '@/content/guides/pub-event-ideas';
import { pubSocialMediaIdeas } from '@/content/guides/pub-social-media-ideas';
import { reelsIdeasForRestaurantsAndPubs } from '@/content/guides/reels-ideas-for-restaurants-and-pubs';
import { restaurantSocialMediaIdeas } from '@/content/guides/restaurant-social-media-ideas';
import { seasonalMarketingIdeasForPubsAndRestaurants } from '@/content/guides/seasonal-marketing-ideas-for-pubs-and-restaurants';
import { socialMediaContentCalendar } from '@/content/guides/social-media-content-calendar';
import { socialMediaForBars } from '@/content/guides/social-media-for-bars';
import { socialMediaMarketingForRestaurants } from '@/content/guides/social-media-marketing-for-restaurants';
import { valentinesDayMenuIdeas } from '@/content/guides/valentines-day-menu-ideas';

/**
 * Every published guide.
 *
 * To add one: write `src/content/guides/<slug>.ts` exporting
 * `defineGuide({...})` (see types.ts for the fields), import it here and add
 * it to the list. `npm run test:ci` then checks it (dates, links, lengths, no
 * em dashes) along with the pages that show it.
 *
 * The first guides follow the keyword plan of 29 September 2026.
 */
const GUIDES: readonly Guide[] = [
  pubSocialMediaIdeas,
  restaurantSocialMediaIdeas,
  socialMediaContentCalendar,
  cafeSocialMediaIdeas,
  linkInBioForVenues,
  bestTimeToPostOnInstagramUk,
  howToPromoteAnEventOnFacebook,
  christmasMarketingIdeasForPubsAndRestaurants,
  foodAndDrinkCaptionsForInstagram,
  hashtagsForCafesPubsAndRestaurants,
  howToTakeFoodPhotosWithYourPhone,
  reelsIdeasForRestaurantsAndPubs,
  socialMediaMarketingForRestaurants,
  hotelSocialMediaIdeas,
  socialMediaForBars,
  seasonalMarketingIdeasForPubsAndRestaurants,
  howToReplyToReviews,
  howToScheduleFacebookPosts,
  howToScheduleInstagramPosts,
  bestSocialMediaSchedulingTools,
  aiSocialMediaPostGenerator,
  pubEventIdeas,
  coffeeCaptionsAndQuotes,
  valentinesDayMenuIdeas,
];

export function listGuides(): readonly Guide[] {
  return GUIDES;
}
