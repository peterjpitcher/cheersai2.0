# SPEC: service pages in the homepage style

Peter asked on 30 September 2026 for the sign-in page and the other service pages to match the new public homepage
(`src/features/front-door/front-door-page.tsx`, #155 and #165).

## What changes

Styling only. No wording, route, redirect, form field, server action or database read changes.

The service pages are the pages a visitor or owner sees around the app, outside the signed-in app shell:

| Page | File |
|---|---|
| Sign in | `src/app/(auth)/login/page.tsx` |
| Forgot password | `src/app/(auth)/forgot-password/page.tsx` |
| Choose your password | `src/app/auth/set-password/page.tsx` |
| Confirm and continue (email links) | `src/app/auth/confirm/page.tsx` |
| Start your free trial | `src/app/signup/page.tsx`, `signup-form.tsx` |
| Set up your venue | `src/app/signup/venue/page.tsx`, `venue-form.tsx` |
| No brands assigned yet | `src/app/no-access/page.tsx` |
| Invitations | `src/app/invitations/page.tsx` |

All of them go through one shell, `AuthCard` in `src/components/auth/auth-card.tsx`, which now draws the homepage's
look:

- the ink band with the faint planner grid and the orange glow (`site-grid`, `site-glow`; a new `site-glow-centre`
  keeps the glow behind a centred card at every width);
- the homepage logo (the on-dark file at the header's size) linking home;
- the form in a white card like the hero's planner card (16px radius, large shadow, faint white ring);
- a footer with Terms of Service, Privacy Notice and Help, in the site footer's link style;
- on the sign-in and sign-up pages, from 1024px wide, a hero-style panel beside the card (orange mono eyebrow, large
  white heading with an orange accent, ticked points). Its words are the sign-in page's existing panel text and the
  homepage's own copy (`HERO`, `CLOSING`, `whatYouNeed`), so nothing new is written.

Buttons and links follow the homepage's accessible colours:

- the main button on these pages is ink text on orange (5.1:1), white on the darker orange on hover, 48px tall, as
  the homepage's "Start your free trial". It is a new `cta` variant and `xl` size on the shared `Button`; nothing in
  the app changes, as no existing call uses them;
- links on white use `--c-orange-hi` (5.2:1) instead of `--c-orange` (3.5:1, below AA for small text);
- inputs are 44px tall with 16px text, so a phone does not zoom in when a field is focused.

Two existing faults go with it: `/no-access` and the venue page's "Signed in as" box used colour tokens that do not
exist (`--c-fg`, `--c-fg-muted`, `--c-surface-2`), so their text and box fell back to unstyled defaults.

## Decisions after the first review (Peter, 30 September 2026)

1. Push and open a PR.
2. The legal pages (`/terms`, `/privacy`, `/data-processing`), the Help Centre (`/help`) and the first-post guide
   (`/help/first-post`) get the homepage's header and footer too. They share `PublicPage`
   (`src/features/marketing/public-page.tsx`): the site header, a title band like the guides index's hero, the body
   on paper, and the site footer, which already carries the company details, contacts and legal links, so the old
   legal footer goes. The Help Centre's questions open and close like the homepage's.
3. The sign-in page's "Don't have an account?" line follows the sign-up switch, like the homepage's call to action:
   "Start your free trial" (to `/signup`) while sign-up is open, otherwise "Contact support" by email.

The header's call to action and the sign-in line read the sign-up switch, which can take up to 3 seconds to time
out. Neither page waits for it: each sits in its own Suspense boundary (the header shows without its button, the
line keeps its place blank), as the Help Centre's first-post link already did. The legal pages are now rendered per
request, like the homepage, because their header follows the switch.

The legal tables' sideways-scrolling box now takes keyboard focus (axe `scrollable-region-focusable`, WCAG 2.1.1),
which it failed on phones before.

## Not changed

- The in-app pages and the shared `PendingInvitations` list (also used inside the app).
- The words of the legal pages and the Help Centre.

## Rollback

Revert the PR. No data, settings or migrations are involved.
