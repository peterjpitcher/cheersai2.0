## Final Checks & Safeguards

- Concurrency guard: Single-run advisory lock for cron/backfill to prevent overlap; safe re-entrancy.
- Editorial overrides: YAML support for `force_include`/`suppress` per event/date without an admin UI.
- Brief safety linter: Strip emojis/URLs/prices; UK spelling; profanity/banned-term filter; trademark-safe synonyms.
- Composer integration: Insert brief into a long-text/notes field (not channel-limited caption) to avoid length truncation.
- Cache correctness: Revalidate API cache after cron selection updates to prevent stale overlays.
- Bank holiday reliability: Vendor a fallback copy of the GOV.UK JSON; prefer local snapshot if network unavailable.
- Multi-day handling: Render per-day slices; de-duplicate chips for continuous spans; weekly panel shows once with span note.
- Time specificity: Mark sports times `estimated` until official; avoid time-critical copy until confirmed.
- Job observability: Emit run ids, selection counts, empty-day ratio; alerts on zero selections and job failure; runbook with retry steps.
- Rollback & kill switch: Feature flag to hide UI; separate switch to pause cron; migrations are forwards-only with backward-compatible reads.

