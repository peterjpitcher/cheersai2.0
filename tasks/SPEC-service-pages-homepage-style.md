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

## Not changed

- The in-app pages and the shared `PendingInvitations` list (also used inside the app).
- The legal pages (`/terms`, `/privacy`, `/data-processing`) and `/help`: they are content pages, not service pages.
- The sign-in page still offers "Contact support" to someone without an account; it does not read the sign-up
  switch, so the sign-in page gains no database read.

## Rollback

Revert the PR. No data, settings or migrations are involved.
