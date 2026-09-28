# SPEC: Magic-link emails through Resend

Status: built on `fix/magic-link-resend`, 28 September 2026. Launch blocker approved by Peter the same day ("finish all outstanding launch work today").

## What changes

- `sendMagicLink` (`src/lib/auth/actions.ts`) stops calling `supabase.auth.signInWithOtp`, which sent the link through Supabase's built-in mailer and dashboard template. It now makes the link with the service-role `auth.admin.generateLink({ type: 'magiclink' })` and sends our own email through Resend (`renderMagicLinkEmail` in `src/lib/auth/email-links.ts`: same sender, style and escaping as the reset email).
- The link goes to `/auth/confirm?token_hash=...&type=magiclink&next=...`, with `next` taken from the login form and checked by `safeNextPath` (default `/dashboard`). The GET still only shows "Confirm and continue"; the button POST verifies it as Supabase type `magiclink`.
- `reportAuthFailure` replaces anything shaped like an email address in the error text before it logs or emails the operator.
- `src/lib/auth/otp-errors.ts` is deleted (only `signInWithOtp` used it).

## Why

Supabase's built-in mailer is not for production: a handful of emails an hour, Supabase's sender and branding. Invites, resets and sign-ups already use `generateLink` plus Resend; magic links were the last auth email on Supabase's mailer.

## Decisions

1. **No login is ever created.** `generateLink` type `magiclink` creates a login for an unknown address (checked on the local stack: it answered `verification_type: signup` with a new user). So the address is looked up first: `public.user_auth_snapshot` (the trigger-kept mirror of `auth.users`, as team invites use), then `auth.admin.getUserById` for `email_confirmed_at` (service role cannot read `auth.users`). Unknown address, unconfirmed login (pending invite or sign-up), a snapshot row whose login is gone, or a login whose email no longer matches: nothing is sent, and the answer is `{ success: true }` as for a known address. After `generateLink`, the returned login id must be the one looked up and the type `magiclink`, or nothing is sent and the operator is alerted.
2. **Verify as `magiclink`, not `email`.** On the local stack (GoTrue 2.191) both accept a magic-link token, but `email` also accepts an invite or sign-up token, which would confirm a login nobody has set up. `magiclink` refuses those.
3. **Fail closed.** A limiter, lookup, `generateLink`, missing site URL or Resend failure shows "We could not finish this. Please try again in a minute, or email peter@orangejelly.co.uk." (`CONTACT.email`) and raises `reportAuthFailure('magic_link', ...)`.
4. **Timing.** As with resets, a known address answers more slowly because an email is sent. The limits (3 an hour per email, 10 an hour per IP) are unchanged and bound what that reveals.
5. **Expiry wording.** The email says the link expires in 24 hours, like the reset email: Supabase checks magic-link and recovery tokens against the same email OTP expiry setting.

## Links sent before deploy

Old magic links point at Supabase's own verify endpoint, which then redirects to `/auth/callback`. That route is unchanged, so an unexpired old link keeps working exactly as before. One that fails lands on `/login?error=auth_callback_failed`, the login page's existing link error.

## Deploy order and rollback

- No migration and no new environment variable: `RESEND_API_KEY`, `RESEND_FROM`, `NEXT_PUBLIC_SITE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already used by resets in production.
- No Supabase setting changes. The dashboard's magic-link template and built-in mailer simply stop being used.
- Rollback: revert the PR. Links our code sent (to `/auth/confirm` with `type=magiclink`) would then be refused by the reverted `/auth/confirm` with the login page's link error, and the person asks for a new link.
