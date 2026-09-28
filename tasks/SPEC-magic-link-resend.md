# SPEC: Magic-link emails through Resend

Status: built on `fix/magic-link-resend` (PR #148), 28 September 2026, revised after its review the same day. Launch blocker approved by Peter the same day ("finish all outstanding launch work today").

## What changes

- `sendMagicLink` (`src/lib/auth/actions.ts`) stops calling `supabase.auth.signInWithOtp`, which sent the link through Supabase's built-in mailer and dashboard template. It now makes the link with the service-role `auth.admin.generateLink({ type: 'magiclink' })` and sends our own email through Resend (`renderMagicLinkEmail` in `src/lib/auth/email-links.ts`: same sender, style and escaping as the reset email).
- The link goes to `/auth/confirm?token_hash=...&type=magiclink&next=...`, with `next` taken from the login form and checked by `safeNextPath` (default `/dashboard`). The GET still only shows "Confirm and continue"; the button POST verifies it as Supabase type `magiclink`.
- Magic links and resets refuse to send when the site address is not usable: in production, a localhost, loopback or non-https `NEXT_PUBLIC_SITE_URL` (env.ts falls back to `http://localhost:3000` when it is unset). Separately, `src/env.ts`'s startup check now really refuses `127.0.0.1` (its regex matched a literal backslash).
- No auth email states how long its link lasts (invite, reset, magic link, sign-up confirmation): "This link works once and only for a short time."
- `reportAuthFailure` replaces anything shaped like an email address (plain or `%40`-encoded) in the error text before it logs or emails the operator, keeping stack-trace paths such as `node_modules/@supabase/...` intact.
- `src/lib/auth/otp-errors.ts` is deleted (only `signInWithOtp` used it).

## Why

Supabase's built-in mailer is not for production: a handful of emails an hour, Supabase's sender and branding. Invites, resets and sign-ups already use `generateLink` plus Resend; magic links were the last auth email the app sent through Supabase's mailer.

## Decisions

1. **A link is only made for an existing, confirmed login.** `generateLink` type `magiclink` creates a login for an unknown address (checked on the local stack: it answered `verification_type: signup` with a new user). So the address is looked up first: `public.user_auth_snapshot` (the trigger-kept mirror of `auth.users`, as team invites use), then `auth.admin.getUserById` for `email_confirmed_at` (service role cannot read `auth.users`). Unknown address, unconfirmed login (pending invite or sign-up), a snapshot row whose login is gone, or a login whose email no longer matches: nothing is sent, and the answer is `{ success: true }` as for a known address.
2. **The one way a login can still be created, and its clean-up.** If the looked-up login is deleted in the instant between the lookup and `generateLink`, Supabase creates a new, unconfirmed login for the address. The returned login id then differs from the looked-up one: nothing is sent, and the new login is deleted (`auth.admin.deleteUser`) when it is plainly that stray: created in the last 10 minutes, never confirmed or signed in, no brand membership and no team invitation. The operator alert says a stray login was created (by user id, never the email) and whether it was removed; a failed removal asks for it to be deleted in Supabase Auth. Left behind, such a login would block later magic links and a reset would confirm it.
3. **Verify as `magiclink`, not `email`.** On the local stack (GoTrue 2.191) both accept a magic-link token, but `email` also accepts an invite or sign-up token, which would confirm a login nobody has set up. `magiclink` refuses those.
4. **Fail closed.** A limiter, lookup, `generateLink`, unusable site address or Resend failure shows "We could not finish this. Please try again in a minute, or email peter@orangejelly.co.uk." (`CONTACT.email`) and raises `reportAuthFailure('magic_link', ...)`.
5. **No link lifetime in any email.** Supabase sets it (its email OTP expiry). The live security advisor does not raise its "OTP expiry longer than an hour" warning, so production's is one hour or less; the old "expires in 24 hours" in the invite, reset and sign-up emails was wrong. The emails now promise no duration, so a later change to the setting cannot make them wrong again.

## Accepted as they are

- **Timing.** A confirmed address answers more slowly than an unknown or unconfirmed one, because a link is made and an email sent. The reset path has the same difference today; the limits (3 an hour per email, 10 an hour per IP) bound what it reveals.
- **Login-CSRF lure.** Someone could request a magic link for their own login and get a venue to press it, signing the venue in as them. This is the same risk recovery links carry today; `/auth/confirm` needs a button press, and `/signup/venue` shows "Signed in as ..." before anything is created.
- **Supabase's own endpoints.** The app no longer sends through Supabase's mailer, but Supabase's public `/auth/v1/otp` endpoint (and likewise `/auth/v1/recover`) still exists: called directly with the public key, it would email a Supabase-mailer link to an existing login. No login is created that way, because public sign-up is off. No Supabase setting is changed here.

## Links sent before deploy

Old magic links point at Supabase's own verify endpoint, which then redirects to `/auth/callback`. That route is unchanged, so an unexpired old link keeps working exactly as before. One that fails lands on `/login?error=auth_callback_failed`, the login page's existing link error.

## Deploy order and rollback

- No migration and no new environment variable: `RESEND_API_KEY`, `RESEND_FROM`, `NEXT_PUBLIC_SITE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already used by resets in production.
- No Supabase setting changes.
- The env.ts fix refuses a production start whose `NEXT_PUBLIC_SITE_URL` contains `127.0.0.1`; Production and Preview use https domains, so nothing that runs today is refused.
- Rollback: revert the PR. Links our code sent (to `/auth/confirm` with `type=magiclink`) would then be refused by the reverted `/auth/confirm` with the login page's link error, and the person asks for a new link.
