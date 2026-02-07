This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### 1. Configure environment variables

Supabase powers authentication. Create a `.env.local` with at least:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="public-anon-key"
SUPABASE_SERVICE_ROLE_KEY="service-role-key"

# existing integrations
RESEND_API_KEY="..."
RESEND_FROM="..."
OPENAI_API_KEY="..."
```

Builds now fail fast if the Supabase URL or anon key is absent, so keep them set for every environment.

Create a Supabase auth user whose `app_metadata.account_id` (preferred) or `user_metadata.account_id` points at a row in `public.accounts` (for local single-tenant work you can reuse `00000000-0000-0000-0000-000000000001`). Without that mapping you’ll stay on `/login` because row-level security filters everything else.

You can link an auth user and bootstrap the account row with:

```bash
npm run ops:link-auth-user -- --email you@example.com --account 00000000-0000-0000-0000-000000000001
```

Optional flags `--display-name` and `--account-email` let you override what lands in `public.accounts`.

Row-level security policies now guard every multi-tenant table, using `user_metadata.account_id` as the selector. When adding new tables make sure to add matching RLS policies so the session-scoped Supabase client can access its own rows.

### 2. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visitors are redirected to `/login`; signing in routes you to `/planner`.

## Running tests

Vitest uses mocked Supabase clients but still expects the environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://supabase.local" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="anon-key" \
SUPABASE_SERVICE_ROLE_KEY="supabase" \
npm run test -- --run
```

CI pipelines should export the same Supabase variables (URL, anon key, service role key) so builds, tests, and `npm run ci:verify` operate against the secured schema.
