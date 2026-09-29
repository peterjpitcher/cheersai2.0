import type { RichText } from '@/content/rich-text';
import { PLANS, TRIAL_DAYS, TRIAL_PLAN } from '@/lib/billing/plans';
import { WEEKLY_MAX_OCCURRENCES } from '@/lib/constants';
import { COMPANY, CONTACT, LEGAL_DOCUMENTS } from '@/lib/legal/company';
import { VENUE_TYPES, type VenueType } from '@/lib/signup/venue-form';

/**
 * The homepage's words (rendered by src/features/front-door/front-door-page.tsx).
 *
 * Every claim was checked against the code on 29 September 2026. They hold
 * for a new self-serve venue once the launch gates in SPEC-self-serve-signup
 * (§4.8 and §6) have passed: Meta App Review approved with Advanced access and
 * the D7 gate passed, then billing enforcement on, then the sign-up switch on.
 * Until App Review, a new venue cannot connect Facebook or Instagram at all.
 * Prices, limits and the trial come from PLANS; company facts and contacts
 * from company.ts; venue types from the sign-up form. Never add paid ads,
 * tournaments or the management-app import (they are off for new venues),
 * and never add testimonials, ratings, customer names or statistics.
 */

/** When the homepage copy last changed, for the sitemap. Update it with the copy. */
export const HOME_CONTENT_UPDATED = '2026-09-29';

export const HERO = {
  eyebrow: 'Social media for pubs, bars, restaurants, cafes and hotels',
  title: "Tell Cheers what's on.",
  titleAccent: 'It writes the posts and puts them out on time.',
  intro:
    "Describe a post once and Cheers writes a version for Facebook and one for Instagram, in your venue's voice. You check it, approve it and pick the time. Cheers does the posting.",
  secondaryCta: 'See how it works',
  points: ['Facebook Pages and Instagram', 'You approve every post', `From ${COMPANY.legalName}, a UK company`],
} as const;

/** Under the hero button while sign-up is open. */
export function heroTrialNote(): string {
  return `${TRIAL_DAYS}-day free trial, one per business. Cancel before day ${TRIAL_DAYS + 1} and you pay nothing.`;
}

export const HOW_IT_WORKS = {
  eyebrow: 'How it works',
  heading: 'From idea to posted in four steps',
  intro: 'You stay in charge of every word. Cheers does the writing and the posting.',
  steps: [
    {
      title: 'Tell Cheers about your venue',
      body: 'Pick your type of venue, set your tone and list the phrases you like and the ones you never want to see. Then connect your Facebook Page and Instagram account.',
    },
    {
      title: 'Describe the post once',
      body: 'A line or two is enough, such as quiz night this Thursday from 8pm or a new lunch menu from Monday. Add a photo from your library.',
    },
    {
      title: 'Check it and approve it',
      body: 'Cheers writes a version for Facebook and one for Instagram. Change anything you like, then approve it. Nothing goes out until you do.',
    },
    {
      title: 'Cheers posts it on time',
      body: 'Approved posts go out at the time you picked. Each one is checked before it is sent, and if one cannot go out, Cheers emails you.',
    },
  ],
} as const;

export type FeatureIcon = 'voice' | 'platforms' | 'planner' | 'publishing' | 'events' | 'weekly' | 'library' | 'link' | 'team';

export interface Feature {
  readonly icon: FeatureIcon;
  readonly title: string;
  readonly body: string;
}

export const FEATURES_SECTION = {
  eyebrow: 'What you get',
  heading: 'What Cheers does for your venue',
  intro: 'Writing, planning and posting, handled in one place.',
} as const;

/**
 * The seats each plan includes, from PLANS, with the trial's own limit: a
 * trial of any plan runs on the trial plan's limits (effectivePlanForLimits),
 * so Professional's extra seats start only when the trial ends. Null when a
 * plan has no fixed limits.
 */
function seatsSentence(): string | null {
  const starter = PLANS.starter.limits;
  const professional = PLANS.professional.limits;
  if (!starter || !professional) return null;
  const trial = PLANS[TRIAL_PLAN].limits;
  const duringTrial = trial ? ` (${trial.seats} during the free trial, whichever plan you choose)` : '';
  return `${PLANS.starter.name} includes ${starter.seats} team seats and ${PLANS.professional.name} includes ${professional.seats}, counting the owner${duringTrial}.`;
}

export function homeFeatures(): Feature[] {
  const seats = seatsSentence() ?? 'Every plan includes team seats, counting the owner.';
  return [
    {
      icon: 'voice',
      title: 'Posts that sound like you',
      body: 'Cheers writes to your brand profile: your type of venue, your tone, the phrases you use and the ones you never want to see.',
    },
    {
      icon: 'platforms',
      title: 'Facebook and Instagram from one idea',
      body: 'Describe a post once and get a version written for each platform, ready for you to check.',
    },
    {
      icon: 'planner',
      title: 'Your week on one calendar',
      body: 'See every post in the planner. Review, edit, approve and reschedule them in one place.',
    },
    {
      icon: 'publishing',
      title: 'Posting that happens on time',
      body: 'Approved posts publish automatically at the time you set. Cheers checks each one before it goes and emails you if something fails.',
    },
    {
      icon: 'events',
      title: 'Events that build up to the night',
      body: 'Add an event and Cheers plans the posts in the run-up, with a banner on the photo such as Tonight or This Friday, and a story alongside each post.',
    },
    {
      // As the create wizard works: every date's post is written up front,
      // approved there, then scheduled; nothing carries on past the end date.
      icon: 'weekly',
      title: 'Weekly regulars, set up once',
      body: `Quiz every Tuesday or curry night every Thursday? Pick the days, a time and an end date. Cheers writes a post for every date in one go for you to check and approve, then puts each one out on its day, up to ${WEEKLY_MAX_OCCURRENCES} dates at a time.`,
    },
    {
      icon: 'library',
      title: 'A photo library that sorts itself',
      body: 'Upload your photos to the library and Cheers names and tags them, so the right picture is easy to find next time.',
    },
    {
      icon: 'link',
      title: 'A link-in-bio page',
      body: "Give Instagram visitors one link with buttons to book, call, find you or see your menu, plus what's on now.",
    },
    {
      icon: 'team',
      title: 'Room for your team',
      body: `${seats} An owner invites the rest of the team by email.`,
    },
  ];
}

export const AUDIENCE_SECTION = {
  eyebrow: 'Who it is for',
  heading: 'Made for hospitality',
  intro: 'Tell Cheers what kind of place you run and it writes for it.',
} as const;

/** The venue types the homepage names: every sign-up venue type except "other". */
export type NamedVenueType = Exclude<VenueType, 'other'>;

/** What each venue type might post about, keyed by the sign-up form's venue types. */
const AUDIENCE_EXAMPLES: Record<NamedVenueType, { heading: string; examples: string }> = {
  pub: {
    heading: 'Pubs',
    examples: 'Quiz nights, live sport, Sunday roasts and the first sunny day in the beer garden.',
  },
  bar: { heading: 'Bars', examples: 'Cocktail lists, DJ nights, live music and private hire.' },
  restaurant: {
    heading: 'Restaurants',
    examples: 'New menus, set lunches, special dinners and weekend bookings.',
  },
  cafe: { heading: 'Cafes', examples: "Today's bakes, brunch, seasonal drinks and new opening hours." },
  hotel: {
    heading: 'Hotels',
    examples: 'Weekend stays, afternoon tea, weddings and events in your function room.',
  },
};

export interface Audience {
  readonly type: NamedVenueType;
  readonly heading: string;
  readonly examples: string;
}

export function audiences(): Audience[] {
  return VENUE_TYPES.flatMap((venue) =>
    venue.value === 'other' ? [] : [{ type: venue.value, ...AUDIENCE_EXAMPLES[venue.value] }],
  );
}

export function otherVenueNote(): string {
  const other = VENUE_TYPES.find((venue) => venue.value === 'other');
  return other
    ? `Run something else? Choose ${other.label} when you sign up.`
    : 'Run another kind of hospitality business? Cheers works for you too.';
}

export const PRICING_SECTION = {
  eyebrow: 'Prices',
  heading: 'Simple monthly or yearly prices',
  intro: 'Pick a plan and pay monthly or yearly.',
  /** Terms section 6 and decision L2: every price is shown ex VAT. */
  vat: 'All prices are ex VAT. We add VAT at the UK rate.',
  /** Terms section 4's words, then what they mean in practice (PlanLimits.postsPerMonth). */
  placements:
    'Each Facebook or Instagram placement counts as a separate published post: a post on Facebook and Instagram counts as two, and a story on both counts as two more.',
  /** Every OpenAI call is one generation (src/lib/ai/usage.ts); one call writes both versions of a post. */
  aiGenerations:
    'An AI generation is Cheers writing or rewriting one post (its Facebook and Instagram versions together), or naming and tagging one photo.',
} as const;

/** What a venue needs before starting a time-limited trial (SPEC-self-serve-signup R19). */
export function whatYouNeed(): string[] {
  return [
    "Admin access to your venue's Facebook Page.",
    'For Instagram, a professional Instagram account linked to that Facebook Page.',
    `A card for the free trial. Your first payment is taken on day ${TRIAL_DAYS + 1}, unless you cancel before then.`,
  ];
}

export interface FaqItem {
  readonly question: string;
  readonly answer: RichText;
}

export const FAQ_SECTION = {
  eyebrow: 'Questions',
  heading: 'Questions and answers',
} as const;

/** The FAQs. The page shows them and repeats them word for word in FAQPage JSON-LD. */
export function homeFaq(): FaqItem[] {
  const { terms, privacy, dpa } = LEGAL_DOCUMENTS;
  const seats = seatsSentence();
  const team: FaqItem[] = seats
    ? [
        {
          question: 'Can my team use Cheers?',
          answer: `Yes. ${seats} An owner can invite team members by email.`,
        },
      ]
    : [];
  return [
    {
      question: 'Which social networks does Cheers post to?',
      answer: 'Facebook Pages and Instagram professional accounts. Cheers does not post to any other network.',
    },
    {
      question: 'Who writes the posts?',
      answer:
        'Cheers suggests drafts with AI, and AI can get things wrong. You check every post before it is published, and you decide what goes out.',
    },
    {
      question: 'Will the posts sound like my venue?',
      answer:
        'Cheers writes to your brand profile: your type of venue, your tone, the phrases you like and the ones you never want used. You can edit any post before you approve it.',
    },
    {
      question: 'How does the free trial work?',
      answer: `New subscriptions start with a ${TRIAL_DAYS}-day free trial, one per business. We take your card details at the start, and your first payment is taken on day ${TRIAL_DAYS + 1}, unless you cancel before then. During the trial, the ${PLANS[TRIAL_PLAN].name} limits apply, whichever plan you choose.`,
    },
    {
      question: 'Can I cancel?',
      answer:
        'Yes. An owner can cancel at any time in Cheers under Settings, Billing, Manage billing, or by emailing us. Cancelling stops the next renewal, and you keep access until the end of the period you have paid for.',
    },
    {
      question: 'Do you give refunds?',
      answer:
        'We do not refund part of a month or year, including on annual plans. The free trial is your chance to try Cheers first.',
    },
    {
      question: 'Can I change plan?',
      answer:
        'Yes. An upgrade takes effect straight away. A downgrade takes effect at your next renewal. If you change plan during the trial, the trial keeps running and nothing is charged until it ends.',
    },
    ...team,
    {
      question: 'Who can sign up?',
      answer: 'We sell Cheers only to businesses. Each business can have one free trial.',
    },
    {
      question: 'What happens to my data?',
      answer: [
        'Our ',
        { text: privacy.title, href: privacy.path },
        ' explains what we collect and why, and our ',
        { text: dpa.title, href: dpa.path },
        ' covers the data we handle for your venue. The ',
        { text: terms.title, href: terms.path },
        ' set out the rest.',
      ],
    },
  ];
}

export type TrustIcon = 'company' | 'people' | 'security' | 'terms';

export interface TrustPoint {
  readonly icon: TrustIcon;
  readonly title: string;
  readonly body: RichText;
}

export const TRUST_SECTION = {
  eyebrow: 'Who we are',
  heading: "Who's behind Cheers",
} as const;

export function whatsappUrl(): string {
  return `https://wa.me/${CONTACT.whatsappE164.replace('+', '')}`;
}

export function trustPoints(): TrustPoint[] {
  const { terms, privacy, dpa } = LEGAL_DOCUMENTS;
  return [
    {
      icon: 'company',
      title: 'A UK company',
      body: `${COMPANY.tradingName} is a trading name of ${COMPANY.legalName}, a company registered in ${COMPANY.registeredIn}, company number ${COMPANY.companyNumber}. VAT number ${COMPANY.vatNumber}.`,
    },
    {
      icon: 'people',
      title: 'People you can talk to',
      body: [
        'Email ',
        { text: CONTACT.email, href: `mailto:${CONTACT.email}` },
        ' or message us on WhatsApp at ',
        { text: CONTACT.whatsappDisplay, href: whatsappUrl() },
        '.',
      ],
    },
    {
      icon: 'security',
      title: 'Your accounts stay yours',
      body: 'The access you give Cheers to your Facebook Page and Instagram account is stored encrypted, and an owner can disconnect it at any time.',
    },
    {
      icon: 'terms',
      title: 'Clear terms',
      body: [
        'Pay monthly or yearly and cancel any time; you keep access until the end of the period you have paid for. Read our ',
        { text: terms.title, href: terms.path },
        ', ',
        { text: privacy.title, href: privacy.path },
        ' and ',
        { text: dpa.title, href: dpa.path },
        '.',
      ],
    },
  ];
}

export const GUIDES_TEASER = {
  eyebrow: 'Guides',
  heading: 'Guides for hospitality social media',
  intro: 'Plain-English advice on what to post, when and how.',
  link: 'See all guides',
} as const;

export const CLOSING = {
  trialHeading: 'Ready to try Cheers?',
  talkHeading: 'Want to try Cheers?',
  trialText: `Start with a ${TRIAL_DAYS}-day free trial. Set up your venue, connect Facebook and Instagram, and plan your first posts.`,
  talkText: 'Email us or message us on WhatsApp and we will answer your questions.',
} as const;
