Progress update (PR 3 + PR 4 scaffolding): Occurrence expansion and selection

- scripts/inspiration/expand.ts: Expands `events` into `event_occurrences` for a given range using RRULEs (batch upsert; dry-run supported). Defaults to a 13‑month horizon.
- scripts/inspiration/select.ts: Scores occurrences and selects up to 2 per day with diversity tie‑break; upserts into `idea_instances` (dry‑run supported).
- lib/inspiration/scoring.ts: Initial scoring and diversity helpers (category bases + weekend uplift + slug overrides for tentpoles).
- package.json: Added `inspiration:expand(:dry)` and `inspiration:select(:dry)` scripts.

Notes:
- Requires installing dependencies (rrule): run `npm install` once.
- Special spans default: British Pie Week (7 days), Royal Ascot (5 days). Others default to single‑day until calculators/data provide spans.
- Movable/announced‑late items (e.g., Pancake Day, FA Cup Final) are skipped for now; calculators to be added next.

Next up:
- Add calculators for Easter/Shrove Tuesday/Mother’s Day and placeholders for sports with “estimated” certainty.
- Wire a monthly cron that runs: import (catalog updates) → expand → select.
