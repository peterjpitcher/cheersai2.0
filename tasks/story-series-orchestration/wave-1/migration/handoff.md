# Wave 1 / Migration — Handoff

## Outputs
- supabase/migrations/20260507130000_drop_story_series_campaign_type.sql
- Commit: 8fff2d6 feat: drop story_series campaign type

## Format
Postgres SQL migration.

## Issues
None.

## Downstream notes
- Migration file is ready for orchestrator to apply via Supabase MCP.
- After application, posting_defaults' campaigns_campaign_type_check will accept only ('event','promotion','weekly','instant').
- Existing story_series rows are migrated to 'event'; their content_items keep placement='story'.
