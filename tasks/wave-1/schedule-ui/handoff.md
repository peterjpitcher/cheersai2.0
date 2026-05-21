# Schedule Step UI — Handoff

## What was done

Complete rewrite of `src/features/create/steps/schedule-step.tsx` to replace the single datetime-local picker with the multi-slot `ScheduleCalendar` component.

### Changes

- **Props interface updated**: `scheduledAt`/`onScheduledAtChange` replaced with `selectedSlots`/`onSlotsChange` (using `ScheduleSlot` from `@/types/content`). Added `accountId` prop.
- **ScheduleCalendar integrated**: renders the full calendar with month navigation, suggestion pills, and existing planner items.
- **Content-type-aware suggestions**: uses `buildEventSuggestions`, `buildPromotionSuggestions`, `buildWeeklySuggestions` from `suggestion-utils.ts` based on `contentBrief.contentType`, with proper type narrowing for the discriminated union.
- **Suggestion deconfliction**: calls `deconflictSuggestions` with existing planner items to avoid suggesting occupied days.
- **Existing planner items**: fetches via dynamic import of `getCalendarItemsAction` (2 args: startIso, endIso — auth context handles account scoping). Uses 3-month window around initial month. Graceful degradation on failure.
- **Slot management**: `handleAddSlot` rejects past dates, dedupes, enforces max 12 slots (1 for story with replacement), reattaches suggestion labels. `handleRemoveSlot` filters by stable key.
- **Stable slot keys**: `suggestion:{id}:{date}:{time}` for matched suggestions, `manual:{date}:{time}` for custom.
- **Publish mode toggle**: preserved from original for `instant_post` content type. "Post Now" clears slots. Non-instant types always show calendar.
- **Initial month derivation**: event -> eventDate month, promotion -> endDate month, else current month.
- **Summary**: slot count below calendar, amber warning when schedule mode has zero slots.

## Assumptions

1. `getCalendarItemsAction` takes 2 arguments (`startIso`, `endIso`) — confirmed by reading the existing action at `src/app/actions/content.ts:360`. Auth context provides account scoping.
2. The `CalendarItemDisplay` type returned by the action structurally matches `ExistingPlannerItemDisplay` from schedule-calendar.tsx (verified — identical shape).
3. ScheduleCalendar does not expose an `onMonthChange` callback, so existing items are fetched once for a 3-month window around the initial month. The `fetchedRangesRef` deduplication prevents re-fetches.
4. The `accountId` prop is included in the interface for future use but not passed to the action (auth context handles it).

## Files modified

- `src/features/create/steps/schedule-step.tsx` — complete rewrite (only file modified)

## Files NOT modified (per constraints)

- `schedule-calendar.tsx`
- `suggestion-utils.ts`
- Wizard core
- Types file
- Content actions

## Issues / follow-ups

1. **No onMonthChange callback**: if the user navigates to a month outside the 3-month prefetch window, existing items won't appear for that month. Consider adding an `onMonthChange` prop to `ScheduleCalendar` in a future pass.
2. **Wizard parent needs updating**: the parent wizard must be updated to pass the new props (`selectedSlots`, `onSlotsChange`, `accountId`) instead of the old `scheduledAt`/`onScheduledAtChange`. This is the wizard agent's responsibility.
3. **Non-instant content types and publishMode**: for non-instant types, `publishMode` is always effectively "schedule" — the toggle is hidden. The parent should pass `publishMode: 'schedule'` for these types.

## Verification

- TypeScript: `npx tsc --noEmit` — clean (0 errors)
- Lint: `npx eslint src/features/create/steps/schedule-step.tsx` — clean (0 warnings)
