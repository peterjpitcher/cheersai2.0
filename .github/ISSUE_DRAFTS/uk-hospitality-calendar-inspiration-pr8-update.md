Progress update (PR 8): Calendar UI overlay + drafts

- components/dashboard/CalendarWidget
  - Added Inspiration overlay toggle with chips in month view (max 2/day), fetching from `/api/inspiration` for the current view range.
  - Weekly panel lists the top ~5 picks for the selected week with quick actions (View/Add Draft).
  - Pop-up dialog shows the brief (250‑word text) and actions.
  - Add Draft opens the existing QuickPostModal, pre-filling the brief as initial content and defaulting the date to the event date.
- components/quick-post-modal.tsx
  - New prop `initialContent?: string` to prefill draft content when opened.
- app/api/inspiration/route.ts
  - Now returns `event_id` and includes the latest brief text per event in response, to avoid extra round trips.

Notes:
- Overlay toggle defaults ON; performance is protected by range-based fetch and brief coalescing.
- Sports/alcohol per-user toggles are respected by the API; a dedicated UI for toggling can be added next if desired.

Next up:
- Polish (chip categories/colors, minor loading state tweaks), and optional per-user toggle controls in the UI.
