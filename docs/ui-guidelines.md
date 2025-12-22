# UI & UX Simplification Guidelines

## 1. Design Principles
- **Single Focus per Screen**: Planner, Create, Library, Connections, Settings each solve one primary task.
- **Progressive Disclosure**: Advanced options hidden behind expandable sections (e.g. "Fine-tune schedule").
- **Consistency**: Use existing design tokens and typography; avoid introducing new component variants without need.
- **Mobile First**: Ensure key actions stay reachable on small screens; the planner calendar collapses into stacked day cards with inline actions.

## 2. Planner View
- Primary canvas is a full-month calendar laid out in a six-row grid. Day cards show date, weekday, time chips, platform/status badges, and thumbnail previews.
- Navigation controls (previous/next month + Today) sit above the calendar; the timezone label is displayed alongside the month heading.
- Command Centre modules stack on the left; the status feed lives directly beneath to keep the page narrow and readable on smaller screens.
- Each scheduled item exposes quick "View" and "Delete" links; deleting cascades to the publish queue and removes the card immediately.
- Ensure hover states remain subtle (border + background shift) and that the day card scrollbars feel unobtrusive when many posts exist.

## 3. Create Flow
- Stepper layout with sticky header: Details → Content → Schedule → Review.
- Inline validation with friendly copy; highlight required fields (dates, CTA, media). Photo/video uploads are capped at 5 MB.
- Schedule step surfaces a calendar with default suggestions at 07:00 in the owner’s timezone; operators can toggle suggested dates on/off and add extras before generating copy.
- Content step hosts unified editor with platform tabs; preview area uses device frames for clarity. Approval modals let users swap hero media post-by-post before confirming.
- Summary page lists per-platform copy and final schedule with edit links.

## 4. Library
- Media grid with filters (images/videos/tags). Include quick preview modal with metadata + recommended use cases.
- Saved drafts list; show status (Draft/Scheduled) and quick access to edit.
- Prompt presets tab for future expansion; initial version can hold default suggestions.

## 5. Connections
- Card per provider showing status badges (Active, Expiring, Needs Action).
- Display location/page names, refresh button, last refreshed timestamp.
- Provide reconnect CTA and guidance copy when status not active.

## 6. Settings
- Grouped sections: Brand Voice, Posting Defaults, Notifications, Account Security.
- Use sliders for tone controls with descriptive labels (e.g. "Formal" vs "Casual").
- Provide live preview snippet updating as controls change.

## 7. Components & Patterns
- Reuse shadcn UI components already in repo; avoid bespoke styles.
- Use toasts for success confirmations, banners for warnings/errors.
- Keep modals purposeful; prefer side-drawer for detailed editing when context needs to remain visible.
- Buttons: primary for action, secondary for cancel/back; maintain accessible contrast.

## 8. Content Preview Tabs
- Tabs labelled "Facebook", "Instagram", "GBP".
- Each tab shows copy, media thumbnails, platform-specific tips.
- Include character counters and validation messages inline (e.g. "GBP requires CTA").

## 9. Accessibility
- Ensure keyboard navigability for drag-and-drop alternative (add "Move earlier/later" buttons).
- Provide ARIA labels for platform icons and status badges.
- Maintain minimum touch target size (44px) for mobile controls.

## 10. Visual Design Tweaks
- Simplify colour usage: primary, secondary, subtle background for sections.
- Use consistent spacing scale (4/8/12/16 etc.) to avoid layout drift.
- Replace verbose copy with concise instructions and microcopy.

## 11. Future Design Tasks
- Create Figma refresh referencing new IA.
- Prototype Planner interactions (drag, reschedule modal) before build.
- Conduct quick usability test with owner once high-fidelity mock ready.
