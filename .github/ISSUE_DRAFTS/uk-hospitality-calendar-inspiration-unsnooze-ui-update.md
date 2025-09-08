Progress update (UI polish): Manage Snoozes

- app/api/inspiration/snoozes/list/route.ts: New GET endpoint returning snoozed items (date, event_id, event name/category) for a date range.
- components/dashboard/CalendarWidget:
  - Weekly panel now includes a toggle to “Manage snoozes”.
  - Snoozed items within the current view range are listed with an Unsnooze action.
  - Snooze/Unsnooze immediately refetches the overlay and snooze list.

This makes it easy to recover hidden ideas without touching the global selection.
