# Campaign Engagement Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show campaign Reach and a reliable Meta reactions, comments and shares breakdown beside clicks and booking outcomes.

**Architecture:** Add zero-default integer metric columns to campaigns, ad sets and ads through an additive migration. Extend the existing Meta Insights mapper and performance sync, carry the values through current row mappers, then render one compact Engagement cell. Production migration application remains a separate approval-gated operation.

**Tech Stack:** Next.js 16.2, React 19.2, TypeScript strict, Vitest 4, Supabase Postgres 17, Meta Marketing API.

**Spec:** `tasks/SPEC-campaign-engagement-scoreboard.md`

## Global Constraints

- Facebook and Instagram only. Do not introduce Google Business Profile.
- Europe/London remains the business timezone.
- Every service-role query must retain explicit `account_id` scoping.
- Store `metrics_reactions`, `metrics_comments` and `metrics_shares` as `integer not null default 0` on `meta_campaigns`, `ad_sets` and `ads`.
- Map `post_reaction` to reactions, `comment` to comments and `post` to shares.
- Derive engagement total as reactions + comments + shares. Ignore broad Meta engagement totals.
- Keep booking-led scoreboard sorting unchanged. Do not add CPC or frequency to the main table.
- Do not apply production SQL, push, merge or deploy without separate permission.
- Preserve the existing uncommitted `tasks/lessons.md` change.

---

### Task 1: Add and locally prove the database foundation

**Files:**
- Create via CLI: the exact `supabase/migrations/*_campaign_engagement_metrics.sql` path returned by Step 2
- Create: `supabase/tests/campaign_engagement_metrics_verify.sql`
- Modify: `supabase/SCHEMA.md`

**Interfaces:**
- Consumes: production schema findings in the approved spec.
- Produces: three zero-default engagement columns on campaigns, ad sets and ads.

- [x] **Step 1: Recheck production read-only**

Use Supabase `execute_sql` against `nbkjciurhvkfpcpatbnt`. Confirm the nine columns are absent and recheck views, functions, triggers, policies, row estimates and sizes. Stop if the live shape changes the risk.

- [x] **Step 2: Create the migration through the CLI**

```bash
npx supabase migration new campaign_engagement_metrics
```

Record the generated filename in this plan before editing it. Never invent a migration timestamp.

- [x] **Step 3: Write the migration**

```sql
alter table public.meta_campaigns
  add column if not exists metrics_reactions integer not null default 0,
  add column if not exists metrics_comments integer not null default 0,
  add column if not exists metrics_shares integer not null default 0;

alter table public.ad_sets
  add column if not exists metrics_reactions integer not null default 0,
  add column if not exists metrics_comments integer not null default 0,
  add column if not exists metrics_shares integer not null default 0;

alter table public.ads
  add column if not exists metrics_reactions integer not null default 0,
  add column if not exists metrics_comments integer not null default 0,
  add column if not exists metrics_shares integer not null default 0;
```

- [x] **Step 4: Write the verification script**

Create one `do $$` block that loops over the three tables and columns and raises on a missing or incorrect definition:

```sql
do $$
declare
  v_table text;
  v_column text;
  v_type text;
  v_nullable text;
  v_default text;
begin
  foreach v_table in array array['meta_campaigns', 'ad_sets', 'ads'] loop
    foreach v_column in array array['metrics_reactions', 'metrics_comments', 'metrics_shares'] loop
      select data_type, is_nullable, column_default
        into v_type, v_nullable, v_default
        from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = v_column;
      if v_type is null then raise exception '%.% missing', v_table, v_column; end if;
      if v_type <> 'integer' then raise exception '%.% must be integer', v_table, v_column; end if;
      if v_nullable <> 'NO' then raise exception '%.% must be not null', v_table, v_column; end if;
      if v_default <> '0' then raise exception '%.% default must be 0', v_table, v_column; end if;
    end loop;
  end loop;
end $$;
```

- [x] **Step 5: Update the schema snapshot**

Add the three fields after `metrics_clicks` in the `ad_sets`, `ads` and `meta_campaigns` sections of `supabase/SCHEMA.md`.

- [x] **Step 6: Rebuild and verify locally**

```bash
npm run db:rebuild
supabase db lint --local
psql "$(supabase status -o env | sed -n 's/^DB_URL=//p')" -v ON_ERROR_STOP=1 -f supabase/tests/campaign_engagement_metrics_verify.sql
```

Expected: all commands exit zero. Confirm the temporary staged v1 baseline migration is absent from `git status`.

- [x] **Step 7: Commit the database foundation**

```bash
git add supabase/migrations/*_campaign_engagement_metrics.sql supabase/tests/campaign_engagement_metrics_verify.sql supabase/SCHEMA.md
git commit -m "feat: add campaign engagement metric columns"
```

Do not apply the migration to production.

---

### Task 2: Parse Meta engagement actions without changing bookings

**Files:**
- Modify: `src/lib/meta/marketing.ts`
- Test: `tests/lib/meta/marketing.test.ts`

**Interfaces:**
- Consumes: Meta `actions` entries.
- Produces: `CampaignInsights.reactions`, `.comments`, `.shares` as numbers.

- [x] **Step 1: Extend the existing mapping test**

Add these fixtures and expected result fields:

```ts
{ action_type: 'post_reaction', value: '11' },
{ action_type: 'comment', value: '4' },
{ action_type: 'post', value: '2' },
```

```ts
reactions: 11,
comments: 4,
shares: 2,
```

- [x] **Step 2: Add malformed and duplicate action coverage**

Use duplicate valid reactions, a negative comment, a non-numeric share, plus `post_engagement` and `page_engagement`. Assert valid duplicates sum, invalid values contribute zero, broad totals are ignored and purchases remain unchanged.

- [x] **Step 3: Confirm the focused test fails**

```bash
npm run test:ci -- tests/lib/meta/marketing.test.ts
```

- [x] **Step 4: Implement defensive parsing**

```ts
function sumActionValues(
  actions: Array<{ action_type?: string; value?: string }> | undefined,
  actionType: string,
): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((total, action) => {
    if (action.action_type !== actionType) return total;
    const parsed = Number(action.value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? total + parsed : total;
  }, 0);
}
```

Add the three required properties to `CampaignInsights` and map them from `row?.actions`. Do not change purchase parsing.

- [x] **Step 5: Run and commit focused work**

```bash
npm run test:ci -- tests/lib/meta/marketing.test.ts
git add src/lib/meta/marketing.ts tests/lib/meta/marketing.test.ts
git commit -m "feat: map Meta campaign engagement actions"
```

---

### Task 3: Persist and map engagement through the campaign model

**Files:**
- Modify: `src/lib/campaigns/performance-sync.ts`
- Modify: `src/types/campaigns.ts`
- Modify: `src/app/(app)/campaigns/actions.ts`
- Test: `tests/lib/campaigns/performance-sync.test.ts`
- Test: `tests/lib/campaigns/campaign-actions.test.ts`

**Interfaces:**
- Consumes: Task 1 columns and Task 2 `CampaignInsights` fields.
- Produces: `CampaignPerformanceMetrics.reactions`, `.comments`, `.shares` at all three object levels.

- [x] **Step 1: Add failing sync assertions**

Add the three fields to every `CampaignInsights` fixture. Use distinct values per campaign, ad set and ad response, then assert each update payload contains its matching values:

```ts
metrics_reactions: 12,
metrics_comments: 3,
metrics_shares: 2,
```

- [x] **Step 2: Add failing row-mapper assertions**

Test numeric database fields. Test a legacy row with missing fields and require zeros.

- [x] **Step 3: Confirm focused failures**

```bash
npm run test:ci -- tests/lib/campaigns/performance-sync.test.ts tests/lib/campaigns/campaign-actions.test.ts
```

- [x] **Step 4: Extend persistence**

Add to `buildMetricsUpdate()`:

```ts
metrics_reactions: insights.reactions,
metrics_comments: insights.comments,
metrics_shares: insights.shares,
```

Do not add them to `ad_metrics_history`.

- [x] **Step 5: Extend types, selects and mappers**

Add required numeric fields to `CampaignPerformanceMetrics`, snake-case fields to the campaign, ad set and ad database row types, and the relevant Supabase select lists. Map each with `Number(row.metrics_* ?? 0)`. Update strict test fixtures with zero values.

- [x] **Step 6: Verify and commit**

```bash
npm run test:ci -- tests/lib/campaigns/performance-sync.test.ts tests/lib/campaigns/campaign-actions.test.ts
npm run typecheck
git add src/lib/campaigns/performance-sync.ts src/types/campaigns.ts 'src/app/(app)/campaigns/actions.ts' tests/lib/campaigns/performance-sync.test.ts tests/lib/campaigns/campaign-actions.test.ts
git commit -m "feat: persist campaign engagement metrics"
```

---

### Task 4: Show the impact funnel in the scoreboard

**Files:**
- Modify: `src/features/campaigns/CampaignDashboard.tsx`
- Test: `src/features/campaigns/CampaignDashboard.test.tsx`

**Interfaces:**
- Consumes: reach, reactions, comments, shares and clicks from `CampaignPerformanceMetrics`.
- Produces: Reach and Engagement columns with a labelled breakdown.

- [x] **Step 1: Write the failing populated-state test**

```ts
performance: {
  ...EMPTY_PERFORMANCE,
  reach: 950,
  reactions: 48,
  comments: 6,
  shares: 3,
  clicks: 32,
},
```

Assert headers `Reach` and `Engagement`, reach `950`, engagement total `57`, breakdown `48 reactions · 6 comments · 3 shares`, and existing clicks `32`.

- [x] **Step 2: Write the zero-state test**

Assert `EMPTY_PERFORMANCE` shows total `0` and `0 reactions · 0 comments · 0 shares` rather than missing data.

- [x] **Step 3: Confirm the component test fails**

```bash
npm run test:ci -- src/features/campaigns/CampaignDashboard.test.tsx
```

- [x] **Step 4: Implement the layout**

Order columns as Campaign, Status, Reach, Engagement, Clicks, CTR, Bookings, Cost/booking, Spend, Last sync, Actions. Increase the minimum width only enough to prevent collisions.

Add a focused `EngagementCell` that derives:

```ts
const total = performance.reactions + performance.comments + performance.shares;
const detail = `${formatNumber(performance.reactions)} reactions · ${formatNumber(performance.comments)} comments · ${formatNumber(performance.shares)} shares`;
```

Leave `compareCampaignScoreboard()` unchanged.

- [x] **Step 5: Verify and commit**

```bash
npm run test:ci -- src/features/campaigns/CampaignDashboard.test.tsx
npm run lint:ci
git add src/features/campaigns/CampaignDashboard.tsx src/features/campaigns/CampaignDashboard.test.tsx
git commit -m "feat: show campaign reach and engagement"
```

---

### Task 5: Complete local verification and prepare the production gate

**Files:**
- Modify: `tasks/PLAN-campaign-engagement-scoreboard.md` to record exact results.

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces: verified local commits and a production approval packet, without applying or deploying.

- [x] **Step 1: Run the full repository gate**

```bash
npm run ci:verify
```

- [x] **Step 2: Review the complete change**

```bash
git diff origin/main...HEAD --check
git status -sb
rg -n "metrics_(reactions|comments|shares)" src tests supabase
```

Confirm only planned files changed, `tasks/lessons.md` remains untouched, no secret is present, service-role reads remain account-scoped, and the staged baseline migration is absent.

- [x] **Step 3: Prepare but do not execute the production packet**

```bash
shasum -a 256 supabase/migrations/*_campaign_engagement_metrics.sql
```

Recheck live schema and migration history. Present the project ref, exact file, checksum, SQL, lock assessment, local validation, rollback SQL and post-apply verification in one approval request. Stop for approval of that exact packet.

- [x] **Step 4: Record results and commit the plan update**

Record the generated migration filename, exact test totals and build result, tick completed steps, then commit only the plan:

```bash
git add tasks/PLAN-campaign-engagement-scoreboard.md
git commit -m "docs: record engagement implementation verification"
```

Production migration application and application deployment remain separate user-approved actions.

## Implementation Results

- Migration: `supabase/migrations/20260922034915_campaign_engagement_metrics.sql`
- Migration SHA-256: `a173f83cf7f51271e2ee8e61fd1df18c9f790d93bed019ac9da49c41ab985b86`
- Local database: rebuild passed; verification SQL passed; database lint exited zero with one existing unrelated `increment_rate_limit` warning.
- Focused integration: 94 tests passed across eight files.
- Full `npm run ci:verify`: lint and typecheck passed; 2,377 tests passed and 3 skipped in each timezone run; production build completed with 33 pages.
- Independent review: no functional or data-integrity defects found. Three trailing spaces in the spec were removed before the final diff check.
- Production read-only recheck: all nine columns remain absent; the latest applied migration remains `20260910113202`; the three tables are small and have no dependent views, materialised views, functions or triggers.
- Production migration and application deployment have not been run.
