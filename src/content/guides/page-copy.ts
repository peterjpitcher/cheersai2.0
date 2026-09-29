/** The fixed words on /guides and on every guide page (the articles' own words live in their modules). */
export const GUIDE_PAGE_COPY = {
  home: 'Home',
  guides: 'Guides',
  contents: 'On this page',
  related: 'More guides',
  updated: 'Updated',
  readingTime: (minutes: number): string => `${minutes} min read`,
  sideHeading: 'Let Cheers write the posts',
  sideText:
    "Describe a post once. Cheers writes it for Facebook and Instagram in your venue's voice, ready for you to check.",
  homeLink: 'See how Cheers works',
  indexCtaHeading: 'Put these guides into practice',
  indexCtaText:
    "Cheers writes your venue's Facebook and Instagram posts, ready for you to check, approve and schedule.",
} as const;
