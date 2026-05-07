# Wave 1 / Migration 1 — Handoff

## Outputs
- `supabase/migrations/20260507100000_banner_overlay_add_columns.sql` (new file, 82 lines)
- Commit: `74c4923 feat: add banner override and account-default columns`

## Format
SQL migration file (Postgres / Supabase). Verbatim from Task 1, step 1 of the plan.

## Schema added by this migration
- `content_variants`: 5 nullable override columns
  - `banner_enabled` (boolean)
  - `banner_text_override` (text, CHECK length <= 20)
  - `banner_position` (text, CHECK in top/bottom/left/right)
  - `banner_bg` (text, CHECK matches `^#[0-9A-Fa-f]{6}$`)
  - `banner_text_colour` (text, CHECK matches `^#[0-9A-Fa-f]{6}$`)
- `posting_defaults`: 4 NOT NULL account-default columns
  - `banners_enabled` (boolean, default `true`)
  - `banner_position` (text, default `bottom`, CHECK enum)
  - `banner_bg` (text, default `#000000`, CHECK hex)
  - `banner_text_colour` (text, default `#FFFFFF`, CHECK hex)
- Idempotent-friendly: data copy block only updates rows where `banner_enabled IS NULL` and `prompt_context ? 'bannerConfig'`.

## Assumptions
- The plan's SQL is authoritative; copied verbatim with no edits to column names, CHECK regexes, defaults, or the `DO $$ ... $$` data-copy block.
- The new column names do not collide with existing `content_variants` banner-lifecycle columns added by `20260427120000_add_banner_variant_columns.sql` (`banner_state`, `bannered_media_path`, `banner_label`, `banner_rendered_for_scheduled_at`, `banner_source_media_path`, `banner_render_metadata`). Confirmed via remote `information_schema` query.
- No collision on `posting_defaults` — only `default_posting_time` and `venue_location` were added previously (`20260410130000_posting_defaults_new_fields.sql`).
- Filename timestamp `20260507100000` does not conflict with any existing migration (latest pre-existing was `20260504000000_conversion_first_copy_optimiser.sql`).

## Issues — IMPORTANT FOR REVIEWER

The plan's verification steps (3 and 4) require applying the migration to a local database via `npx supabase db push`. **I was unable to apply or verify the migration in any database.** Reasons:

1. **No local Supabase stack available.** `npx supabase status` failed with `Cannot connect to the Docker daemon`. Docker is not running on this machine, so `supabase start` cannot bring up a local Postgres + Supabase services.
2. **No CLI link to remote project.** `npx supabase db push --dry-run` failed with `Cannot find project ref. Have you run supabase link?`. There is no `supabase/.temp/` directory to indicate a previously linked ref.
3. **Brief explicitly forbids pushing to remote.** "Do NOT push to remote." — so I deliberately did NOT use the Supabase MCP `apply_migration` tool against the remote `cheersai2.0` project (`nbkjciurhvkfpcpatbnt`) even though it would succeed. The columns added are additive and low-risk, but the brief is unambiguous.

What I did do as a safety check (read-only):
- Queried `information_schema.columns` on the remote `cheersai2.0` project to confirm none of the 9 new columns exist there yet. They don't — only the legacy banner_state lifecycle columns. So when this migration is eventually pushed (locally first, then remote), it will apply cleanly without column-already-exists errors.

What is therefore NOT verified and needs to happen before downstream waves rely on the schema:
- [ ] `npx supabase db push --dry-run` printing the new file's SQL with no errors.
- [ ] `npx supabase db push` applying cleanly to a local DB.
- [ ] The Step 3 verification SELECT showing all 9 new columns with correct nullability and defaults.
- [ ] The Step 4 negative INSERTs both failing with check-constraint violations:
  - `INSERT INTO public.content_variants (content_item_id, banner_position) VALUES (gen_random_uuid(), 'centre');` → expect `violates check constraint`.
  - `INSERT INTO public.posting_defaults (account_id, banner_bg) VALUES (gen_random_uuid(), 'red');` → expect `violates check constraint`.

The orchestrator (or a follow-up agent with Docker running) needs to start the local Supabase stack and run those verification steps before downstream Wave 2 agents act on the assumption that these columns are real.

## Downstream notes
- The columns are now defined in source for Wave 2 agents to read/write in TypeScript (server actions, types, banner config resolver, etc.). However, see "Issues" — they have not been confirmed to exist in any running database.
- Data copy from `prompt_context.bannerConfig` will run on first apply. The migration prints a `NOTICE` with per-field copied counts. Worth checking these counts in the apply log when the migration is first run on staging/prod, to confirm legacy data flowed through as expected.
- The data-copy block is one-shot: it only updates rows where `banner_enabled IS NULL`, so re-running the migration (which Postgres won't do, but in case of a manual re-apply pattern) is a no-op for already-migrated rows.
- Migration 2 (Task 12 in the plan) drops the legacy columns. That migration will need to be guarded against running before this one, but Postgres applies migrations in timestamp order so this is automatic as long as the file naming convention is preserved.
