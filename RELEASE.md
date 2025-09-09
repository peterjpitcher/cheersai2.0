# Release Checklist

Use this checklist for every production deployment.

- Database
  - [ ] All migrations applied on staging and prod
  - [ ] RLS policies verified for new tables

- Feature Flags / Config
  - [ ] Related env vars added to `.env.example` and set in staging/prod
  - [ ] Flags toggled as per rollout plan

- Build & Observability
  - [ ] CI green: lint, typecheck, tests, build, bundle budgets
  - [ ] Sourcemaps uploaded if applicable (optional)
  - [ ] Dashboards green (publish success ≥95%, queue healthy)
  - [ ] Alerting rules healthy (no open incidents)

- Rollout & Rollback
  - [ ] Preview validated by QA
  - [ ] Rollback plan noted (previous release tag / Vercel deployment)
  - [ ] Stakeholders notified
