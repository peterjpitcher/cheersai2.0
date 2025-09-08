## Implementation Plan (Full)

Overview

- Goal: Surface high‑value UK events with 250‑word briefs, always 12 months ahead.
- Constraints: Channel‑agnostic, single brief for all segments, UK‑centric only.
- Automation: Monthly cron to expand/refresh; no per‑tenant generation at runtime.
- UI: Calendar overlay (max 2 per day) and weekly top picks; “Add Draft” to composer.

Architecture

- Data: Postgres (or existing DB) tables for catalog, occurrences, briefs, and selections.
- Services: Ingestion/expansion worker, scoring/selector, offline brief generator, cron/CLI.
- API: Range‑based fetch of selected inspiration items with per‑user/tenant filtering.
- UI: Calendar overlay + popovers; weekly panel; composer integration.
- Config: Feature flag `calendar_inspiration`; timezone `Europe/London`.

Data Model

- events: id, slug, name, aliases[], category [seasonal|civic|food|drink|sports], alcohol_flag, date_type [fixed|recurring|multi_day], rrule/anchor, source_url, notes, active.
- event_occurrences: id, event_id, start_date, end_date, country="UK", certainty [confirmed|estimated], metadata(jsonb), created_at, updated_at.
- event_briefs: id, event_id, version, text (~250 words), constraints_applied[], drinkaware_applicable, created_at, updated_at.
- idea_instances: id, occurrence_id, rank_score, diversity_bucket [civic|sports|food_drink|seasonal], tags[], selected(bool), created_at, updated_at.
- user_prefs (or extend existing): user_id, show_sports(bool), show_alcohol(bool), updated_at.
- Indexes: unique (event_id, occurrence_date); btree on (start_date); FK indexes; partial on (selected).

Seed Catalog & Sources

- Storage: Versioned YAML/CSV: data/inspiration/events.yaml (+ aliases.yaml).
- Sources (open/public only):
  - GOV.UK bank holidays JSON.
  - Computed Easter, Mothering Sunday (UK), Shrove Tuesday.
  - Cultural/seasonal/food/drink observances via official orgs + Wikipedia (with source URLs).
  - Sports (UK‑centric only): Six Nations (home nations), FA Cup Final, Champions League Final (UK‑hosted years), Premier League opening/final day, Grand National, Royal Ascot, Wimbledon finals.

Ingestion & Expansion

- Importer: Parse YAML, upsert events, validate uk_centric=true, derive RRULEs/fixed dates.
- Expansion: Generate next 13 months of event_occurrences; set certainty and metadata (e.g., kickoff times when public).
- Idempotency: Deterministic key (event_id + date); tolerate reruns; prevent duplicates.
- Validation: Alias dedupe; recurrence lint; exclude non‑UK items.

Brief Generation

- Template: Deterministic structure—summary; date/time specifics; why it matters; activation ideas; content angles; 5–10 generic hashtags; image/asset text; accessibility cue; DrinkAware note when alcohol_flag.
- Constraints: Text‑only; no emojis, URLs, or prices/discounts; avoid restricted trademarks.
- Pipeline: Iterate events missing/outdated briefs; generate ~250 words; validate with linter; retry N times; store with version/constraints_applied.
- Cadence: Weekly or part of monthly cron; also on catalog change.

Scoring & Selection

- Weights: National awareness (0.40), hospitality impact (0.35), seasonal/lead‑time (0.15), weekday uplift (0.05), sports interest (0.05 when relevant).
- Diversity tie‑break: If scores within ±7, prefer civic/seasonal > sports > food/drink.
- Daily cap: Max 2 per date; allow empty days.
- Selection: Upsert idea_instances(selected=true) for the horizon; don’t mutate prior months unless backfilling.

Cron & CLI

- Cron: 02:00 Europe/London on the 1st monthly.
- Steps: Expand next 13 months; score; apply diversity; upsert selections; emit metrics.
- Backfill: `backfill-inspiration --from=YYYY-MM --to=YYYY-MM [--dry-run]`.
- DST: TZ‑aware scheduler; test around transitions.

API & Services

- GET /api/inspiration?from=YYYY-MM-DD&to=YYYY-MM-DD
  - Returns up to 2 items/day after applying user_prefs and tenant alcohol_free.
  - Fields: date, name, category, brief preview, flags, actions.
- Caching: 15–30 min per tenant/range; revalidate after cron.

UI/UX

- Calendar overlay: Toggle in header; chips with category color + rank badge; popover on click.
- Popover: Summary, dates/times, why it’s big, brief preview; actions: Add Draft, Read full brief, Snooze.
- Weekly panel: Top ~5 with lead‑time cues; Add Draft.
- Accessibility: Focus‑visible rings; keyboard nav; SR labels; contrast.

Settings & Flags

- Feature flag: calendar_inspiration.
- User prefs: show_sports, show_alcohol (default true).
- Tenant trait: alcohol_free hides alcohol items automatically.

Observability

- Metrics: Items/day, empty‑day ratio, cron duration, API cache hit, impressions, brief opens, Add‑Draft clicks.
- Alerts: Zero selections, cron failure, brief generator error rate.

Security & Access

- Read: Tenants can read global selections/briefs; scoped by date range.
- Write: Only service jobs update catalog/occurrences/briefs/instances.
- No PII stored; audit job runs via logs/metadata.

Migrations & Backfill

- Add tables/indexes; default user_prefs (sports/alcohol=true).
- Seed import; expand current + next 12 months; generate briefs.
- Run backfill once post‑deploy to guarantee horizon.

Testing Strategy

- Unit: RRULE expansion; Easter/Mothering/Shrove calculators; scoring; diversity.
- Validation: Brief linter (length/banned tokens/no URLs/prices/emojis).
- Integration: Cron dry‑run determinism; API returns <=2/day.
- UI: Snapshot + a11y; E2E Add‑Draft.
- Perf: API <150ms for 6‑week window.

Rollout Plan

- Phase 0: Staging behind flag; seed 80–120 events; verify end‑to‑end.
- Phase 1: Internal enable; monitor one cron cycle.
- Phase 2: Gradual prod rollout; docs/changelog.
- Contingency: Disable flag to hide UI; pause cron independently.

Work Breakdown (PRs)

- [ ] PR 1: Migrations + models + repo interfaces + user prefs
- [ ] PR 2: YAML schema + importer + validation + seed catalog
- [ ] PR 3: Occurrence expansion (rrule + calculators) + idempotent upserts
- [ ] PR 4: Scoring + selector + diversity + tests
- [ ] PR 5: Brief generator pipeline + constraint linter + storage
- [ ] PR 6: Cron job + backfill CLI + metrics + alerts
- [ ] PR 7: API endpoint + caching + auth
- [ ] PR 8: Calendar overlay UI + popovers + weekly panel + Add‑Draft
- [ ] PR 9: Observability dashboards + docs; flag wiring; rollout

Timeline

- Week 1: Schema, importer, expansion, seed 80–120 events.
- Week 2: Scoring/selection, brief generator, cron + backfill.
- Week 3: API + UI overlay/popovers + Add‑Draft.
- Week 4: Weekly panel, metrics/alerts, polish, rollout.

Acceptance Criteria

- Max 2 inspiration items/day; some days empty.
- Data 12 months ahead; monthly cron idempotent and observable.
- Every selected event has a stored 250‑word brief (text‑only, constraints applied); DrinkAware on alcohol events; hidden for alcohol‑free venues.
- User toggles work; Add‑Draft creates a composer draft prefilled with the brief.

Risks & Mitigations

- Late sports times: Use `estimated`; avoid time‑specific copy; update when confirmed.
- Trademark risks: Allow/deny list; linter; safe synonyms.
- Overcrowded dates: Cap + diversity tie‑break; allow empty days.
- Brief quality drift: Deterministic templates; lints; periodic regeneration/versioning.

