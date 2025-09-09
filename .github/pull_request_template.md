## Summary

Describe what this PR changes and why. Include context, linked issues, and any screenshots/GIFs for UI changes.

## Checklist

- [ ] Lint/typecheck/tests/build pass locally:
  - `npm run lint:ci`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
- [ ] Bundle budget passes: `npm run check:bundle`
- [ ] API routes validate inputs with Zod and export `runtime`
- [ ] Tenancy enforced (`tenant_id` scoped) in all DB interactions
- [ ] External calls use retry/timeout/circuit breaker (where applicable)
- [ ] Observability present (structured logs, error mapping)
- [ ] No secrets committed; `.env.example` updated if needed
- [ ] Docs updated (README/AGENTS/CONTRIBUTING) if behaviour/config changed
- [ ] UI uses shadcn/ui; legacy classes avoided; Chromatic diffs reviewed (if UI)
- [ ] DB migrations tested locally and documented (if schema changed)

## Testing Notes

How did you test this change? Add steps for reviewers to verify.

## Screenshots / Videos (if UI)

Add media to demonstrate the change.

