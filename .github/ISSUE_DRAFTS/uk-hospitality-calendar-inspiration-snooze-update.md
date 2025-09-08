Progress update (UI polish): Snooze per user + API

- supabase/migrations/20250908123000_inspiration_snoozes.sql
  - New table `inspiration_snoozes` (user_id, event_id, date). RLS: users can read/write their own; unique (user_id, event_id, date).
- app/api/inspiration/snoozes/route.ts
  - POST: { event_id, date } to snooze the idea for the day; DELETE: ?event_id=&date= to undo.
- app/api/inspiration/route.ts
  - Excludes snoozed items for the current user. Response now includes event_id for client actions.
- components/dashboard/CalendarWidget
  - Weekly panel: added Snooze action for each idea; View and Add Draft unchanged.
  - Dialog: added Snooze button; Add Draft pre-fills brief as before.

Notes:
- Snoozes are per-user and do not affect global selection.
- Overlay respects sports/alcohol prefs and snoozes; still caps 2/day.
