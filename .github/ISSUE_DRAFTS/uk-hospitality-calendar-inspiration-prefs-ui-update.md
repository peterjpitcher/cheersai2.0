Progress update (PR 8 polish): Per-user Sports/Alcohol toggles

- app/api/inspiration/prefs/route.ts: New GET/POST endpoint to read/update per-user inspiration preferences (sports/alcohol), persisted in `user_prefs` (RLS protected).
- components/dashboard/CalendarWidget:
  - Added Sports and Alcohol checkbox toggles next to the Inspiration overlay toggle.
  - Toggles persist via the new API and trigger a refetch so server-side filtering applies immediately.

Notes:
- Defaults remain ON; users can hide sports/alcohol items without affecting global data selection.
- Overlay + weekly panel continue to cap two items/day and show top ~5 per week.
