Progress update (PR 5 scaffolding): Brief generator

- scripts/inspiration/generate-briefs.ts: Offline, deterministic generator creates ~250‑word briefs per event (text‑only; no emojis/links/prices). It includes date specifics (plain‑language), activation ideas, content angles, hashtags, asset guidance, and DrinkAware note when alcohol_flag is set.
- package.json: Added `inspiration:briefs(:dry)` scripts.

How to run locally:
- Dry run: `npm run inspiration:briefs:dry`
- Generate/upsert: `npm run inspiration:briefs` (uses service‑role client). Will create versioned briefs where missing (or bump version with `--force`).

Next up:
- Cron orchestration (import → expand → select → briefs) and API endpoint for calendar overlay.
