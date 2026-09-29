# SPEC: owners never see technical error text

## Why

Owners (venue customers) were shown raw technical text when something failed: "Invalid or expired
OAuth state" after a stale Connect link, Meta Graph errors such as "OAuthException: ... (code 100)",
Supabase error messages, "Token vault is not configured. Set TOKEN_VAULT_KEY ..." and, in
production, React's own "An error occurred in the Server Components render ..." sentence whenever a
server action threw and the page showed `error.message`.

## Rules

- A server action or route handler never returns `error.message` (or a Graph, Supabase, Stripe,
  OpenAI or Resend message) to the browser. It returns a plain British English sentence that says
  what failed and what to do next, and logs the technical detail with `createLogger()` from
  `src/lib/logging`. Tokens, keys and personal data are never logged.
- A client component never shows the message of an error it caught. A server action that throws
  reaches the browser, in production, as React's generic "An error occurred in the Server
  Components render ..." sentence (and as the raw message in development), so the component shows
  its own plain fallback. Plain reasons belong in the action's returned `{ error }`.
- Messages already written for owners (validation, plan limits, billing, team, Page chooser) stay.
- Failures still show as failures: only the wording changes, never the outcome or the status.
- `unstable_rethrow(error)` stays at the top of every catch that has it.

## Scope

Connections (including the OAuth callbacks, the Page chooser and the Meta Ads setup on the
Connections page), Create, Planner and Settings. Library, the link-in-bio editor, sign-up and
sign-in, Campaigns and Tournaments are listed in the PR as not changed.

## Rollback

Revert the PR. No migration, no data change, no environment variable.
