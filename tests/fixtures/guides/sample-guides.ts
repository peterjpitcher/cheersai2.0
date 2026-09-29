import { defineGuide } from '@/lib/guides/define-guide';

/**
 * Test fixtures for the guides pages. They are not published: the real list in
 * src/content/guides/index.ts stays empty until the keyword plan is done.
 * They use every block type so the pages, the JSON-LD and the content checks
 * are all exercised.
 */

export const planningGuide = defineGuide({
  slug: 'plan-a-week-of-pub-posts',
  title: 'How to plan a week of social media posts for your pub',
  seoTitle: 'Plan a week of pub social media posts | Cheers',
  description:
    'A simple way to plan a week of Facebook and Instagram posts for your pub, from picking what to post to scheduling it in one sitting.',
  primaryKeyword: 'pub social media plan',
  secondaryKeywords: ['pub social media ideas', 'what to post for a pub'],
  category: 'planning',
  published: '2026-09-01',
  updated: '2026-09-29',
  summary:
    'Pick the few things worth telling people this week, give each one a day and write the posts in one sitting. Here is a way to do it that fits around a busy Monday.',
  intro: [
    'A week of posts takes about an hour once you have a routine: list what is happening, give each thing a day, then write and schedule the lot.',
    ['If you are short of ideas, start with ', { text: 'our stories routine', href: '/guides/instagram-stories-for-restaurants' }, '.'],
  ],
  sections: [
    {
      heading: "Start with what's actually happening",
      blocks: [
        {
          type: 'paragraph',
          text: 'The best posts come from real things at your pub, not from a list of ideas. Before you write anything, jot down what is on this week.',
        },
        {
          type: 'list',
          style: 'bullets',
          items: [
            'Events: quiz night, live music, a big match on the screens.',
            'Food and drink: a new dish, a guest ale, the Sunday roast.',
            [{ strong: 'People' }, ': a new chef, a long-serving regular, the team getting ready for Friday.'],
          ],
        },
        {
          type: 'tip',
          text: 'Keep a note on your phone during the week. When something happens that people would like to see, add it.',
        },
      ],
    },
    {
      heading: 'Give each post a day and a time',
      blocks: [
        {
          type: 'paragraph',
          text: 'Spread the posts out so there is something new most days, and time each one for when people make plans.',
        },
        {
          type: 'list',
          style: 'steps',
          items: [
            'Put events on the day before and again on the day.',
            'Post food when people are thinking about lunch or dinner.',
            'Leave the weekend for photos of the pub at its busiest.',
          ],
        },
        {
          type: 'table',
          caption: 'A sample week of posts',
          head: ['Day', 'Post', 'Its job'],
          rows: [
            ['Monday', 'What is on this week', 'Give people plans'],
            ['Thursday', ['The weekend, with ', { strong: 'booking details' }], 'Ask for the booking'],
            ['Sunday', '', ''],
          ],
        },
      ],
    },
    {
      heading: 'Write it once, then shape it for each platform',
      blocks: [
        {
          type: 'subheading',
          text: 'Facebook',
        },
        {
          type: 'paragraph',
          text: 'Facebook suits the details: times, prices and how to book.',
        },
        {
          type: 'example',
          label: 'Facebook post',
          lines: ['Quiz night is back on Thursday from 8pm.', 'Teams of up to six. Book a table through the link.'],
        },
        {
          type: 'subheading',
          text: 'Instagram',
        },
        {
          type: 'paragraph',
          text: [
            'Instagram is led by the photo, so keep the words short. Our guide to ',
            { text: 'Instagram stories for restaurants', href: '/guides/instagram-stories-for-restaurants' },
            ' covers the quick, everyday side.',
          ],
        },
      ],
    },
  ],
  closing: {
    heading: 'Plan your week in one sitting',
    text: "Tell Cheers what's on and it writes the posts for Facebook and Instagram, ready for you to check and schedule.",
  },
  related: ['instagram-stories-for-restaurants'],
});

export const storiesGuide = defineGuide({
  slug: 'instagram-stories-for-restaurants',
  title: 'Instagram stories for restaurants: a simple routine',
  description:
    'How a restaurant can use Instagram stories every day without it taking over: what to film, when to post and how to keep it simple.',
  primaryKeyword: 'instagram stories for restaurants',
  secondaryKeywords: ['restaurant instagram ideas'],
  category: 'photos',
  published: '2026-08-15',
  updated: '2026-09-10',
  summary: 'Stories are the quick, everyday side of Instagram. A short routine keeps them coming without extra work.',
  sections: [
    {
      heading: 'What to film',
      blocks: [
        {
          type: 'paragraph',
          text: 'Film what guests would see if they walked in now: the pass at service, the specials board, a table being laid.',
        },
      ],
    },
    {
      heading: 'When to post',
      blocks: [
        {
          type: 'paragraph',
          text: 'Post before people decide where to eat, and again during service when the room looks its best.',
        },
      ],
    },
  ],
  closing: {
    heading: 'Stories without the effort',
    text: 'Cheers pairs event posts with a story, so the run-up to a night out takes care of itself.',
  },
});

export const SAMPLE_GUIDES = [planningGuide, storiesGuide];
