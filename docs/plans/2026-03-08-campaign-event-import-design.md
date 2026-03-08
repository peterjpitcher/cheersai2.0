# Campaign Brief — Event Import Design

**Date:** 2026-03-08

## Goal

Allow users to import event details from the management app into the Campaign Brief form, pre-filling the problem brief and campaign dates, in the same way the Create / Planner section already does.

## Approach

Approach A: pre-fill the brief. An "Import event" panel sits above the problem brief textarea. The user searches, picks an event, and clicks "Apply import". The brief textarea is populated with a formatted sentence from the event details, and the campaign start/end dates are auto-set.

## UI

- Collapsible "Import from management app" panel above the problem brief textarea (slate-50 rounded panel, collapsed by default)
- Search input + "Load events" button
- Dropdown of matching events + "Apply import" button
- On apply: brief textarea pre-filled with `"[Event name] on [date]. [Description]."` (editable)
- Confirmation notice: `"Imported details from [event name]."`
- Error states: inline error with Settings link if not configured, empty-state message if no events found
- Overwrite guard: `window.confirm` if problem brief is already non-empty

## Data flow

Reuses existing server actions — no new actions needed:
- `listManagementEventOptions` — fetches/searches events from the management API
- `getManagementEventPrefill` — returns structured event fields (name, description, date, time, bookingUrl, etc.)

New logic in `CampaignBriefForm.tsx` only:
- Import panel state (open, options, selected event, loading, error, notice)
- `buildBriefFromEvent(name, date, description)` — formats the brief string
- `deriveStartDate(eventDate)` — event date minus 7 days, clamped to today if in the past
- On apply: populate `problemBrief`, `startDate`, `endDate`

## Field mapping

| Management event field | Campaign brief field |
|------------------------|----------------------|
| name + date + description | `problemBrief` (formatted text) |
| date − 7 days (min: today) | `startDate` |
| date | `endDate` |

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| Not configured / connection error | Inline error with link to Settings |
| No events returned | `"No events were returned from the management app"` |
| Non-empty brief on import | `window.confirm` overwrite prompt |
| Event has no description | Brief is `"[Event name] on [date]."` |
| Event date in the past | `startDate` = today, `endDate` = event date |

## Files changed

- `src/features/campaigns/CampaignBriefForm.tsx` — only file modified

## Out of scope

- New server actions
- Schema changes
- Changes to the Create / Planner section
