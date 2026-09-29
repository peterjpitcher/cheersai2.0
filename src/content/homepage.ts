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

/**
 * The hero says who Cheers is for before anything else (Peter, 29 September
 * 2026: "really push on how this has been designed for hospitality"). The
 * date strip is automatic on event posts only (createScheduledBatch sets
 * banner_enabled for events), and TONIGHT is its label on the day of an
 * evening event (proximity-label.ts).
 */
export const HERO = {
  eyebrow: 'Social media for pubs, bars, restaurants, cafes and hotels',
  title: 'Made for hospitality.',
  titleAccent: "Cheers writes your venue's posts and puts them out on time.",
  intro:
    "Tell Cheers what's on, from quiz night to the Sunday roast, and it writes a post for Facebook and one for Instagram in your venue's voice. Event posts get THIS FRIDAY or TONIGHT on the picture. Nothing goes out until you approve it.",
  secondaryCta: 'See how it works',
  points: [
    'Event posts that count down to the night',
    'Writes as a pub, bar, restaurant, cafe or hotel',
    'You approve every post',
    `From ${COMPANY.legalName}, a UK company`,
  ],
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

export type HospitalityIcon = 'events' | 'weekly' | 'voice' | 'link';

export interface HospitalityPoint {
  readonly icon: HospitalityIcon;
  readonly title: string;
  readonly body: string;
}

/** Two of the clichés Cheers keeps out of every post (voice.ts BANNED_PHRASES; a page test checks). */
export const CLICHE_EXAMPLES = ['a night to remember', 'mouth-watering'] as const;

export const HOSPITALITY_SECTION = {
  eyebrow: 'Built for venues',
  heading: 'Made for the way venues work',
  intro:
    'Events need a run-up. The quiz comes round every week. Guests want to book a table or see the menu. Cheers is built around all of it.',
} as const;

/**
 * What only a venue needs, each checked against the code on 29 September 2026:
 * - events: the wizard suggests weekly posts up to four weeks out, then two
 *   days, one day and the day itself (event-cadence.ts); an event posts to the
 *   feed and as a story by default (content.ts resolveBatchPlacements, create
 *   schema); its date strip is switched on automatically and the publish
 *   worker prints the label for each post's own date (content.ts,
 *   publish-queue worker and banner-label.ts, mirrored by proximity-label.ts).
 * - weekly: as the create wizard works (every date written up front, approved
 *   there, then scheduled; nothing carries on past the end date).
 * - voice: the venue type from sign-up is brand_profile.business_type, which
 *   the prompt names (venue-form.ts, prompts.ts); British English is in the
 *   prompt; the house list of clichés (voice.ts BANNED_PHRASES) is in the
 *   prompt and removed afterwards (ai-generate.ts, postprocess.ts); tone,
 *   key phrases and banned phrases are the brand voice settings.
 * - link: the public link-in-bio page's buttons, each shown once filled in,
 *   and its "Live now" list (link-in-bio-public-page.tsx).
 */
export function hospitalityPoints(): HospitalityPoint[] {
  return [
    {
      icon: 'events',
      title: 'Events with a proper run-up',
      body: 'Add an event and Cheers suggests the run-up: posts in the weeks before, two days before, the day before and on the day, each on your feed and as a story. The strip on the picture changes as the day gets closer, from THIS FRIDAY to TOMORROW NIGHT to TONIGHT.',
    },
    {
      icon: 'weekly',
      title: 'Weekly regulars, set up once',
      body: `Quiz every Tuesday or curry night every Thursday? Pick the days, a time and an end date. Cheers writes a post for every date in one go for you to check and approve, then puts each one out on its day, up to ${WEEKLY_MAX_OCCURRENCES} dates at a time.`,
    },
    {
      icon: 'voice',
      title: 'Posts that sound like your venue',
      body: `Choose pub, bar, restaurant, cafe or hotel when you sign up and Cheers writes as that kind of place, in British English. It keeps out tired lines like "${CLICHE_EXAMPLES[0]}" and "${CLICHE_EXAMPLES[1]}". Set your tone, add the phrases you always use and ban the ones you never want to see.`,
    },
    {
      icon: 'link',
      title: 'A link in bio for bookings and menus',
      body: "Put one link on your Instagram profile and it opens a page with Book a table, See our menu, Call us and Find us buttons, plus what's on now.",
    },
  ];
}

export type FeatureIcon = 'platforms' | 'planner' | 'publishing' | 'offers' | 'library' | 'team';

export interface Feature {
  readonly icon: FeatureIcon;
  readonly title: string;
  readonly body: string;
}

export const FEATURES_SECTION = {
  eyebrow: 'What you get',
  heading: 'Everything else you need',
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

/**
 * Everything the hospitality section does not already cover. Offers: a
 * promotion needs an end date and the wizard suggests Launch, Mid-run reminder
 * and Last chance posts (promotion-fields.tsx, suggestion-utils.ts). Photos:
 * the library's tags describe the subject, the setting, any food or drink and
 * the mood (media-tagging.ts).
 */
export function homeFeatures(): Feature[] {
  const seats = seatsSentence() ?? 'Every plan includes team seats, counting the owner.';
  return [
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
      icon: 'offers',
      title: 'Specials and offers, start to finish',
      body: 'Running a special, like 2-for-1 cocktails until Sunday? Give it an end date and Cheers suggests a launch post, a reminder and a last-chance post.',
    },
    {
      icon: 'library',
      title: 'A photo library that sorts itself',
      body: 'Upload photos of your food, drinks and venue, and Cheers names and tags them, so the right picture is easy to find next time.',
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
  heading: 'Whatever kind of venue you run',
  intro: 'Tell Cheers what you run when you sign up and it writes for that kind of place.',
} as const;

/** The venue types the homepage names: every sign-up venue type except "other". */
export type NamedVenueType = Exclude<VenueType, 'other'>;

/** What each venue type might post about, keyed by the sign-up form's venue types. */
const AUDIENCE_EXAMPLES: Record<NamedVenueType, { heading: string; examples: string }> = {
  pub: {
    heading: 'Pubs',
    examples: 'Quiz nights, match days, Sunday roasts and the first sunny day in the beer garden.',
  },
  bar: { heading: 'Bars', examples: 'Cocktail lists, DJ nights, live music and private hire.' },
  restaurant: {
    heading: 'Restaurants',
    examples: 'New menus, the specials board, set lunches and Christmas party bookings.',
  },
  cafe: { heading: 'Cafes', examples: "Today's bakes, brunch, seasonal drinks and bank holiday opening hours." },
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

/** "pubs, bars, restaurants, cafes and hotels": the sign-up form's venue types, in its order. */
export function venueTypeList(): string {
  const names = audiences().map((audience) => audience.heading.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
}

/** The FAQ answer on who Cheers is for, from the sign-up form's venue types. */
function whoItIsForAnswer(): string {
  const other = VENUE_TYPES.find((venue) => venue.value === 'other');
  const orOther = other ? `, or ${other.label},` : '';
  return `No. Cheers is made for ${venueTypeList()}. When you sign up you choose your type of venue${orOther} and Cheers writes your posts for that kind of place.`;
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
      question: 'Is Cheers only for pubs?',
      answer: whoItIsForAnswer(),
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
