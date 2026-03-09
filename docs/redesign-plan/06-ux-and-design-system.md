# 06 — UX and Design System

> **Document type**: Redesign planning specification — read-only reference for engineers.
> **Scope**: UX audit, information architecture, text wireframes, design token specification, component patterns, and accessibility requirements for CheersAI 2.0.
> **Date**: 2026-03-05

---

## 1. Current UX Audit

### 1.1 Navigation & Shell

**Dual sidebar implementations** — Severity: Major

The codebase contains two fully-implemented sidebar components: `Sidebar.tsx` (custom, collapsible, Framer Motion animated) and `app-sidebar.tsx` (shadcn/sidebar pattern with Radix primitives). `AppShell.tsx` imports and renders `Sidebar.tsx` exclusively. The `app-sidebar.tsx` component exists but is orphaned. Additionally, `navigation.ts` defines a `NAV_ITEMS` constant that is never imported — both sidebar files and `PageHeader.tsx` each define their own inline nav arrays. This means nav items could diverge silently.

Evidence: `AppShell.tsx:1` imports `Sidebar`, not `AppSidebar`. `navigation.ts` exports `NAV_ITEMS` but no file imports it.

**No mobile bottom navigation bar** — Severity: Critical

On mobile, the `Sidebar` is hidden entirely (`hidden md:flex`). Navigation is only accessible via the hamburger menu in the `Topbar`, which opens a Sheet (slide-in drawer from the left). This is a three-tap journey to navigate (open hamburger, find item, tap). A non-technical pub owner checking the planner on their phone between tasks experiences disproportionate friction. The mobile Sheet also lacks icons, making items harder to scan quickly.

Evidence: `Sidebar.tsx:38` — `className="...hidden...md:flex"`. `PageHeader.tsx:67–106` — `MobileNav()` renders text-only links in a Sheet.

**Active state only matches exact path on legacy Sidebar** — Severity: Minor

`Sidebar.tsx:56` uses `pathname === item.href` (exact match only). `app-sidebar.tsx:87` and `PageHeader.tsx:87` both use `pathname.startsWith(item.url)`. If the legacy Sidebar remains in use, navigating to `/planner/abc123` renders the Planner item as inactive.

Evidence: `Sidebar.tsx:56` vs `app-sidebar.tsx:87`.

**Search input in Topbar is non-functional** — Severity: Minor

`PageHeader.tsx:36–41` renders a search input with placeholder "Search…" but no `onChange` handler, no action, and no associated state. The input is purely decorative and misleads the user into thinking global search exists.

Evidence: `PageHeader.tsx:36–41` — input has no value/onChange/onSubmit.

**Notifications link routes to `/planner/notifications`** — Severity: Minor

The bell icon in Topbar (`PageHeader.tsx:46–53`) always shows a red dot indicator and links to `/planner/notifications`, but no route file exists at that path in the audited file list. This creates a dead-end click pattern.

Evidence: `PageHeader.tsx:46–51` — href="/planner/notifications" with a hardcoded dot.

---

### 1.2 Create Flow

**Five-tab wizard with complex stage accordions is cognitively overloaded** — Severity: Major

The Create page presents five tabs (Instant post, Stories, Event campaign, Promotion, Weekly recurring) inside a full-page wizard. Each tab hosts a `StageAccordion` with 4–6 stages. Stages are open simultaneously by default (`allowMultipleOpen = true`). On mobile, this results in a very long vertical scroll containing multiple open accordion panels simultaneously with form fields interleaved. A non-technical user opening the Create page for the first time sees an overwhelming column of numbered sections with no clear starting point.

Evidence: `create-wizard.tsx:57` — five tabs. `instant-post-form.tsx:281` — four accordion stages. `weekly-campaign-form.tsx:348` — six accordion stages. `stage-accordion.tsx:36` — `allowMultipleOpen = true`.

**"Stories" tab duplicates functionality of "Instant post" tab** — Severity: Major

The Instant Post form already contains a "Story" placement option (a toggle between "Feed post" and "Story"). A separate "Stories" tab in the wizard (`create-wizard.tsx:15–19`) creates an overlapping mental model. The user must understand the distinction between the Story placement within Instant Post and the standalone Story Series form — a distinction not explained anywhere in the UI.

Evidence: `instant-post-form.tsx:313–330` — placement toggle includes "Story". `create-wizard.tsx:14–15` — separate "stories" tab also exists.

**Generate button is detached from form's validation context** — Severity: Major

In both `instant-post-form.tsx` and `weekly-campaign-form.tsx`, the final "Generate & review" stage contains a `<Button type="submit">` directly inside the accordion stage's content. This button is inside a `<form>` wrapping the entire `<StageAccordion>`. However, the user can click "Generate post" without completing required fields in earlier accordion stages (since all stages are simultaneously open and validation is stage-by-stage via `goToNextWhenValid`). If a user collapses Stage 1, skips the "Next" button, and opens Stage 4 to click "Generate", form submission fires and may produce an error that's out of context.

Evidence: `instant-post-form.tsx:559–607` — generate stage with submit button at accordion stage 4, form wraps entire accordion at line 612.

**Progress indicator provides no completion estimate** — Severity: Minor

`GenerationProgress` shows a simulated random-increment progress bar with a message string. The bar never reaches 100% before the timer is cleared (`Math.min(prev + Math.random() * 12 + 3, 90)` — caps at 90). The user cannot distinguish between "almost done" and "something is broken". There is no time estimate or retry mechanism if the generation silently stalls.

Evidence: `generation-progress.tsx:9–23`. `instant-post-form.tsx:163` — random increment capped at 90%.

**Modal vs full-page duality** — Severity: Major

The Create Wizard is used in two contexts: as a full page at `/create` (via `CreatePageClient`) and as a `Dialog` modal (via `CreateModal`). The modal is triggered from the Planner (clicking a calendar date or the "Create weekly plan" button). The modal uses `95vw / 90vh` with `overflow-y-auto`, meaning the entire five-tab wizard including all accordion stages scrolls inside a floating dialog. This pattern is particularly broken on mobile where the modal occupies the full screen but retains modal dismiss behaviour — users can accidentally close their in-progress work.

Evidence: `create-modal.tsx:23` — `w-[95vw] max-w-7xl max-h-[90vh] overflow-y-auto`. `planner-interaction-components.tsx:23` — opens modal with `initialTab: "instant"`.

**No empty-state guidance when library is empty** — Severity: Major

`MediaAttachmentSelector` is used in every form but there is no visible empty-state message when the media library is empty. The `instant-post-form.tsx` and `weekly-campaign-form.tsx` simply pass `library` to the selector — if `library` is `[]` the selector silently renders with no media to pick. A new user has no prompt to upload assets first.

Evidence: `media-attachment-selector.tsx` referenced but not audited in full; `instant-post-form.tsx:527–549` — no empty-state guard before `MediaAttachmentSelector`.

**Form reset after generation discards scheduling intent** — Severity: Minor

After successful generation, both forms call `form.reset(...)` with hardcoded defaults including `publishMode: "now"` and `scheduledFor: undefined`. If the user had chosen "Schedule for later" and set a date, that intent is silently discarded.

Evidence: `instant-post-form.tsx:205–224` — `form.reset()` called with `publishMode: "now"`.

---

### 1.3 Planner View

**Calendar-only view with no list/agenda alternative** — Severity: Major

The Planner page renders a `PlannerCalendar` component. The only view toggle available is `PlannerViewToggle`, which only controls whether images are shown or hidden — not the layout mode. There is no list view, agenda view, or week view. A pub owner checking what posts are going out tomorrow must scan a month-grid calendar, which is particularly difficult on mobile.

Evidence: `planner/page.tsx:58` — only `PlannerCalendar` rendered. `planner-view-toggle.tsx:8–48` — toggles `show_images` param only.

**Planner detail page uses a separate route with no breadcrumb** — Severity: Minor

Clicking a post in the calendar navigates to `/planner/[contentId]`. The page has a "← Back to planner" link in the header action slot, but the `PageHeader` component places actions to the right of the title on desktop and below on mobile. The back link is styled as small muted text, making it easy to miss. There is no breadcrumb navigation.

Evidence: `planner/[contentId]/page.tsx:56–65` — back link is inside the `action` prop of `PageHeader`.

**Publish failure surface is information-dense but not action-oriented** — Severity: Major

The `planner/[contentId]/page.tsx` shows a failure banner with the error message and last-attempt time, and a collapsible "Publish diagnostics" `<details>` element containing the raw JSON provider response. This is developer-facing information. The pub owner sees `{"error": {"code": 190, "message": "Error validating access token..."}}` with no plain-English explanation and no actionable button (e.g. "Reconnect Facebook", "Retry now", "Download post to publish manually").

Evidence: `planner/[contentId]/page.tsx:67–75` — error banner shows raw `detail.lastError` string. Lines 130–146 — raw JSON in `<pre>` tag inside `<details>`.

**Status live-activity drawer hidden behind a button** — Severity: Minor

`StatusDrawer` renders a "Live activity" button that opens a right-side drawer. This button is not consistently placed — it would need to be inserted into pages manually. The planner page does not appear to include it in the audited code, and the drawer's content slot just renders a generic `feed` ReactNode. There is no in-page status summary row.

Evidence: `status-drawer.tsx:34–81` — standalone component with trigger button. `planner/page.tsx` — no reference to `StatusDrawer`.

---

### 1.4 Settings

**Settings page is a single flat form with 12+ URL fields** — Severity: Major

`link-in-bio-profile-form.tsx` contains 11 URL fields on a single page (phone, WhatsApp, booking URL, menu URL, parking URL, directions URL, Facebook URL, Instagram URL, website URL, plus slug and display name). The form is not grouped into logical sections or progressively disclosed. All fields are mandatory-or-optional with no visual distinction.

Evidence: `link-in-bio-profile-form.tsx:67–262` — 11 input fields rendered sequentially.

**Timezone is permanently disabled** — Severity: Major

`posting-defaults-form.tsx:62–63` renders the timezone select with `disabled`. The only option is `DEFAULT_TIMEZONE` (`"Europe/London"`). The UI shows a field that looks editable but is not, and the helper text says "Fixed to London time". A user outside this timezone has no path to change it, which will ship broken posts.

Evidence: `posting-defaults-form.tsx:59–63` — `disabled` attribute + single option in TIMEZONE_OPTIONS.

**No success feedback after saving posting defaults** — Severity: Major

`PostingDefaultsForm.onSubmit` calls `updatePostingDefaults(values)` with `startTransition`. There is no `toast.success(...)`, no inline feedback message, and no visual confirmation that the save succeeded. The button only changes label to "Saving…" during the transition and returns to normal when done.

Evidence: `posting-defaults-form.tsx:44–48` — `await updatePostingDefaults(values)` with no success handling.

---

### 1.5 Connections

**Connection health indicators not integrated into primary navigation** — Severity: Major

The Connections page shows account status, but the main navigation and the Planner page give no visual indication of degraded connection health. A user whose Facebook token expired 3 days ago has no persistent warning — they would only discover this when a post fails.

Evidence: `connections/page.tsx` — connection status isolated to this page. `Sidebar.tsx` — no health badge on Connections nav item. `planner/page.tsx` — no connection health banner.

**OAuth flow success/failure feedback handled via `ConnectionOAuthHandler` with no visible loading state** — Severity: Minor

The Connections page wraps `ConnectionOAuthHandler` in a `<Suspense fallback={null}>`. If the OAuth callback is processing, the user sees no loading indicator — the section simply appears empty.

Evidence: `connections/page.tsx:18` — `<Suspense fallback={null}>`.

---

### 1.6 Component Library Consistency

**Mixed button styles and radii** — Severity: Major

The `Button` component (`button.tsx`) defines `rounded-md` as base style. However, throughout feature components, buttons are overridden with `rounded-full` (e.g. `content-body-form.tsx:104`, `112`; `stage-accordion.tsx` `Next` buttons; `planner-interaction-components.tsx:30`). The result is visible inconsistency: some buttons are pill-shaped, others are rectangular, with no semantic distinction between the two.

Evidence: `button.tsx:32` — base `rounded-md`. `content-body-form.tsx:104` — `rounded-full` override. `weekly-campaign-form.tsx:474` — `rounded-full` raw `<button>` bypassing the Button component entirely.

**Raw `<button>` and `<select>` elements used alongside UI components** — Severity: Minor

`weekly-campaign-form.tsx:471–478` renders a raw `<button>` styled with Tailwind instead of using the `<Button>` component. `posting-defaults-form.tsx:59` and `link-in-bio-profile-form.tsx:103` use raw `<input type="color">` and `<select>` without wrapping them in any UI component, meaning focus rings, disabled states, and dark mode handling must be maintained manually per-instance.

**No `<Textarea>` component** — Severity: Minor

All forms use raw `<textarea>` HTML elements styled inline. There is a `<Input>` component in the UI library but no corresponding `<Textarea>`. This means each textarea has independently styled borders, radii, focus states, and disabled appearances.

Evidence: `instant-post-form.tsx:336–349`, `weekly-campaign-form.tsx:377`, `content-body-form.tsx:81` — all raw textareas.

**`MediaSwapModal` in `generated-content-review-list.tsx` is a custom portal** — Severity: Minor

A custom `MediaSwapModal` is implemented using `createPortal` with manual Escape key handling and `body.style.overflow` manipulation. The project already has a `Dialog` component (Radix UI) that handles all of this correctly and accessibly. Two patterns exist for the same problem.

Evidence: `generated-content-review-list.tsx:415–496`. `dialog.tsx:1–122` — unused for this purpose.

**`StatusDrawer` is a custom drawer** — Severity: Minor

Another custom drawer built with `fixed inset-0` and manual Escape handling, duplicating the `Sheet` component available in `components/ui/sheet.tsx`.

Evidence: `status-drawer.tsx:46–80`. `sheet.tsx` exists in UI library.

---

### 1.7 Form Patterns

**Inline validation error placement is inconsistent** — Severity: Minor

Error messages appear in different vertical positions and with different styles across forms. In `link-in-bio-profile-form.tsx` errors use `text-red-600`, while `instant-post-form.tsx` uses `text-rose-500`. In `content-body-form.tsx:96`, error and feedback messages use `min-h-[1.25rem]` reserved space (good pattern), but this is not followed elsewhere, causing layout shift when errors appear.

**No loading skeleton for the Create modal data fetch** — Severity: Minor

`create-modal.tsx:24–28` shows a centered `Loader2` spinner while `getCreateModalData()` fetches. This is a full-page blank state inside a modal — the user sees a dark overlay and a white spinner with no context about what is loading or how long it will take.

---

## 2. New Information Architecture

### 2.1 Navigation Map

```
PRIMARY NAV (always visible — bottom bar on mobile, left sidebar on desktop)
├── Planner         /planner             Home/default view
├── Create          /create              Launch create flows
├── Library         /library             Media assets
├── Connections     /connections         Social account health
└── Settings        /settings            Brand, defaults, notifications

SECONDARY NAV (page-level tabs or segments within a primary section)
├── Planner
│   ├── Calendar view      /planner?view=calendar   [default]
│   └── List view          /planner?view=list
├── Create
│   ├── Instant post       /create?flow=instant      [default]
│   ├── Event campaign     /create?flow=event
│   ├── Promotion          /create?flow=promotion
│   └── Weekly recurring   /create?flow=weekly
├── Library
│   ├── Images             /library?type=image       [default]
│   └── Videos             /library?type=video
├── Connections
│   (single page — no secondary nav)
└── Settings
    ├── Brand voice        /settings?tab=brand        [default]
    ├── Posting defaults   /settings?tab=defaults
    ├── Notifications      /settings?tab=notifications
    └── Link in bio        /settings?tab=link-in-bio

CONTEXTUAL ACTIONS (appear within pages; do not create top-level nav items)
├── Planner → click calendar day    → open Create bottom sheet (mobile) / slide-over (desktop)
├── Planner → click scheduled post  → navigate to /planner/[contentId]
├── Planner → "New post" FAB        → open Create flow pre-set to Instant Post
├── Library → click asset           → open asset detail drawer
└── Connections → "Connect"         → OAuth redirect flow
```

### 2.2 Route Structure

```
/                                   → redirect to /planner
/planner                            → Planner page (calendar/list view)
/planner/[contentId]                → Post detail / edit page
/create                             → Create wizard (flow selected via query param)
/library                            → Media library
/connections                        → Connections hub
/settings                           → Settings (tab selected via query param)
/l/[slug]                           → Public link-in-bio page (outside app shell)
```

The Stories flow is removed as a top-level tab. Story creation is handled within Instant Post (placement toggle). Story series scheduling is available as an advanced option within the Weekly Recurring flow.

### 2.3 Progressive Disclosure Model

**Always visible (default open):**
- Title/prompt field for Instant Post
- Platform selector (checkboxes, not toggle buttons)
- Publish now vs. schedule toggle
- Primary media attachment area

**Revealed on demand (behind "More options" or "Advanced" disclosure):**
- CTA URL and link goal
- Link-in-bio destination
- Tone adjust (casual/formal slider)
- Length preference
- Hashtag and emoji inclusion toggles
- Proof points
- Manual schedule override for weekly campaigns
- GBP-specific CTA defaults
- Per-platform character count preview

**Never shown inline (accessible via dedicated page or drawer):**
- Raw provider response / publish diagnostics
- OAuth token details
- Platform API rate limit status

---

## 3. Core Flow Wireframes (Text-Based)

All wireframes use the following notation:
- `[ ]` = interactive element (button, input, toggle)
- `< >` = content displayed (text, status, image)
- `---` = visual separator
- Indented blocks = contained within a card or panel

### 3a. Instant Post (Mobile-First)

**Screen 1 — Create Entry**

```
┌─────────────────────────────────────┐
│ < Planner header >      [+ New post]│
├─────────────────────────────────────┤
│  [Calendar grid — current month]    │
│  Mon 3 Mar · 2 posts scheduled      │
│  ● Facebook    10:00  Scheduled     │
│  ● Instagram   10:00  Scheduled     │
│                                     │
│  Wed 5 Mar · Tap to add             │
│  [+] (small circle button)          │
└─────────────────────────────────────┘
[Planner] [Create] [Library] [Connect] [Settings]   ← bottom nav
```

User taps [+ New post] button or the [+] circle on a calendar day.

---

**Screen 2 — Create Flow Selector (bottom sheet, slides up)**

```
┌─────────────────────────────────────┐
│ ▔▔▔▔▔▔▔ drag handle ▔▔▔▔▔▔▔        │
│                                     │
│  What do you want to create?        │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Instant post               │   │
│  │  Write once, post to all    │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Event campaign             │   │
│  │  Countdown + day-of posts   │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Promotion                  │   │
│  │  Launch, mid-run, last call │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Weekly recurring           │   │
│  │  Thursday Quiz, Sunday roast│   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

User taps "Instant post".

---

**Screen 3 — Instant Post Form (full screen, single scrolling page)**

```
┌─────────────────────────────────────┐
│ [← Back]           Instant post     │
│                                     │
│  What should we post?               │
│  ┌─────────────────────────────┐   │
│  │  Textarea — 4 rows          │   │
│  │  e.g. Friday night menu     │   │
│  └─────────────────────────────┘   │
│                                     │
│  Placement                          │
│  (●) Feed   ( ) Story               │
│                                     │
│  Post to                            │
│  [✓ Facebook] [✓ Instagram] [ GBP]  │
│  (Checkbox-style toggle chips)      │
│                                     │
│  When?                              │
│  (●) Publish now  ( ) Schedule      │
│                                     │
│  Media (optional)                   │
│  ┌───┐  ┌───┐  ┌──────────────┐   │
│  │img│  │img│  │  + Add media │   │
│  └───┘  └───┘  └──────────────┘   │
│                                     │
│  [+ More options]   (collapsed)     │
│                                     │
│ ─────────────────────────────────  │
│              [Generate post →]      │
└─────────────────────────────────────┘
```

"More options" expands to show: CTA URL, link goal, tone, length, hashtags, emojis.

User fills in the prompt and taps [Generate post].

---

**Screen 4 — Generating (inline, replaces button)**

```
┌─────────────────────────────────────┐
│ [← Back]           Instant post     │
│  [form fields — read-only during    │
│   generation, inputs dimmed]        │
│                                     │
│  ──────────────────────────────     │
│                                     │
│  Writing your posts…                │
│  ████████████████░░░░░░  68%       │
│  Usually takes 10–20 seconds        │
│                                     │
│          [Cancel]                   │
└─────────────────────────────────────┘
```

---

**Screen 5 — Review & Approve (appended below form, form scrolls up)**

```
┌─────────────────────────────────────┐
│ [← Back]           Instant post     │
│  [collapsed form summary: Friday    │
│   night menu · Facebook, Instagram  │
│   · Publish now]  [Edit]            │
│                                     │
│  Review your posts                  │
│                                     │
│  Friday 7 March 2026                │
│  Publish now                        │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ● Facebook          Draft   │   │
│  │ ┌─────────────────────────┐ │   │
│  │ │  [post image thumbnail] │ │   │
│  │ └─────────────────────────┘ │   │
│  │  "Join us this Friday for…" │   │
│  │  [Edit copy]                │   │
│  │  [Swap media]               │   │
│  │              [Approve]      │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ● Instagram         Draft   │   │
│  │  [media] [copy] [Approve]   │   │
│  └─────────────────────────────┘   │
│                                     │
│  ─────────────────────────────     │
│  [Approve all]         [Done]      │
└─────────────────────────────────────┘
```

After approving, status chip on each card changes from "Draft" to "Scheduled". The [Done] button closes the form and returns to Planner.

---

### 3b. Weekly Campaign Creation

**Screen 1 — Campaign Basics**

```
┌──────────────────────────────────────────┐
│ [← Back]             Weekly recurring     │
│                                          │
│  Step 1 of 4                             │
│  ████░░░░░░  25%                         │
│                                          │
│  Campaign name *                         │
│  ┌────────────────────────────────┐     │
│  │  e.g. Thursday Quiz Night      │     │
│  └────────────────────────────────┘     │
│                                          │
│  What happens each week?                 │
│  ┌────────────────────────────────┐     │
│  │  Textarea (4 rows)             │     │
│  │  Prizes, vibe, what to expect  │     │
│  └────────────────────────────────┘     │
│                                          │
│  Platforms                               │
│  [✓ Facebook] [✓ Instagram] [ GBP]       │
│                                          │
│                  [Next: Set the schedule]│
└──────────────────────────────────────────┘
```

---

**Screen 2 — Schedule Setup**

```
┌──────────────────────────────────────────┐
│ [← Back]             Weekly recurring     │
│                                          │
│  Step 2 of 4                             │
│  ████████░░  50%                         │
│                                          │
│  Which day?                              │
│  [Mon][Tue][Wed][Thu][Fri][Sat][Sun]     │
│      Thu is selected (highlighted)       │
│                                          │
│  What time?      Weeks ahead?            │
│  [20:00     ▾]   [4          ▾]          │
│                                          │
│  Starting from                           │
│  [Thu 6 Mar 2026        date picker]    │
│                                          │
│  Preview: 4 posts will be scheduled     │
│  ┌──────────────────────────────────┐  │
│  │  Thu 6 Mar  ·  20:00             │  │
│  │  Thu 13 Mar · 20:00              │  │
│  │  Thu 20 Mar · 20:00              │  │
│  │  Thu 27 Mar · 20:00              │  │
│  └──────────────────────────────────┘  │
│  [Adjust dates manually ▾]              │
│                                          │
│  [← Previous]      [Next: Add media]    │
└──────────────────────────────────────────┘
```

"Adjust dates manually" expands an inline list where the user can delete slots or add dates via a date picker. The calendar widget is secondary/advanced — default is the list preview.

---

**Screen 3 — Media & Links**

```
┌──────────────────────────────────────────┐
│ [← Back]             Weekly recurring     │
│                                          │
│  Step 3 of 4                             │
│  ████████████░░  75%                     │
│                                          │
│  Hero media (optional)                   │
│  Reused across all weekly slots          │
│  ┌──────┐  ┌──────┐  ┌──────────────┐  │
│  │ img  │  │ img  │  │  + Add media │  │
│  └──────┘  └──────┘  └──────────────┘  │
│                                          │
│  [+ Links & advanced options]  collapsed │
│                                          │
│  [← Previous]      [Next: Generate]     │
└──────────────────────────────────────────┘
```

---

**Screen 4 — Generate & Review**

Identical layout to Instant Post Screen 5 but with multiple time-slot groups (one per week). Each group is a collapsible row.

---

### 3c. Event Campaign Creation

**Screen 1 — Event Details**

```
┌──────────────────────────────────────────┐
│ [← Back]             Event campaign       │
│                                          │
│  Step 1 of 3                             │
│  ████░░░░  33%                           │
│                                          │
│  Event name *                            │
│  [ Live Music Night — The Anchor    ]    │
│                                          │
│  Event date *            Start time      │
│  [ Sat 15 Mar 2026   ▾]  [ 19:00    ]   │
│                                          │
│  End time (optional)                     │
│  [ 23:00                            ]    │
│                                          │
│  Tell us what makes this event special   │
│  ┌────────────────────────────────┐     │
│  │  Textarea (4 rows)             │     │
│  └────────────────────────────────┘     │
│                                          │
│  Platforms                               │
│  [✓ Facebook] [✓ Instagram] [✓ GBP]      │
│                                          │
│                  [Next: Choose timeline] │
└──────────────────────────────────────────┘
```

---

**Screen 2 — Timeline Setup**

```
┌──────────────────────────────────────────┐
│ [← Back]             Event campaign       │
│                                          │
│  Step 2 of 3                             │
│  ████████░░  66%                         │
│                                          │
│  We'll schedule these posts for you:     │
│                                          │
│  ┌──────────────────────────────────┐  │
│  │ [✓] Save the date · Sat 8 Mar    │  │
│  │     7 days before                │  │
│  ├──────────────────────────────────┤  │
│  │ [✓] Reminder · Wed 12 Mar        │  │
│  │     3 days before                │  │
│  ├──────────────────────────────────┤  │
│  │ [✓] It's happening today!        │  │
│  │     Sat 15 Mar · 09:00           │  │
│  ├──────────────────────────────────┤  │
│  │ [✓] Last call · Sat 15 Mar       │  │
│  │     1 hour before · 18:00        │  │
│  └──────────────────────────────────┘  │
│                                          │
│  Uncheck any slots you don't want.       │
│                                          │
│  [← Previous]   [Next: Add media]       │
└──────────────────────────────────────────┘
```

---

**Screen 3 — Media, Links & Generate**

Same as Weekly Campaign Screens 3–4.

---

### 3d. Planner View and Editing a Scheduled Post

**Planner — Desktop Layout**

```
┌────────────────────────────────────────────────────────────────┐
│ Sidebar (collapsed or expanded)  │  Planner                    │
│  ■ Planner                       │  March 2026  [< >]   [+ New] │
│  □ Create                        │                             │
│  □ Library                       │  [Calendar] [List]    [Filters▾]│
│  □ Connections                   │ ────────────────────────────│
│  □ Settings                      │  Mon  Tue  Wed  Thu  Fri    │
│                                  │  3    4    5    6    7      │
│                                  │       ●FB       ●IG  ●FB   │
│                                  │            ●IG      ●IG     │
│                                  │                             │
│                                  │  10   11   12   13   14     │
│                                  │  ●GBP      ●FB  ●IG        │
└──────────────────────────────────┴─────────────────────────────┘
```

Coloured dots: blue = Facebook, magenta/pink = Instagram, green = GBP.
Clicking a dot opens a detail side drawer on desktop (not a full page navigation).

**Planner — List View (toggled via "List" button)**

```
┌────────────────────────────────────────────────────────────────┐
│ Planner              March 2026         [Calendar] [List]  [+] │
├────────────────────────────────────────────────────────────────┤
│ Today — Wednesday 5 March                                       │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  10:00  ● Facebook   Friday menu reveal   [Scheduled]    │ │
│  │         ● Instagram  (same)               [Scheduled]    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ Thursday 6 March                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  20:00  ● Facebook   Thursday Quiz Night  [Scheduled]    │ │
│  │         ● Instagram  (same)               [Scheduled]    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ Saturday 8 March                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  09:00  ● Facebook   Live Music Save the Date [Scheduled]│ │
│  │  (!)    ● Instagram  (same)               [Failed]       │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Status chips: "Scheduled" (blue), "Published" (green), "Failed" (red + warning icon).

**Post Detail — Side Drawer (desktop) / Full screen (mobile)**

```
┌─────────────────────────────────────────┐
│ [← Close]   Thursday Quiz Night         │
│             Facebook · Feed · Scheduled  │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Post image preview]             │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Post copy                 240 chars    │
│  ┌───────────────────────────────────┐ │
│  │  It's Quiz Night at The Anchor…   │ │
│  │  [editable textarea]              │ │
│  └───────────────────────────────────┘ │
│                                         │
│  [Reset]                  [Save copy]  │
│                                         │
│  ─────────────────────────────────     │
│  Schedule          [Reschedule ▾]       │
│  Thu 6 Mar 2026 · 20:00 Europe/London  │
│                                         │
│  Media        [Swap media]              │
│  ┌──────┐ (1 image attached)           │
│  │ img  │                              │
│  └──────┘                              │
│                                         │
│  [Delete post]        [Approve now]    │
└─────────────────────────────────────────┘
```

---

### 3e. Monitoring and Resolving a Publish Failure

**Planner — Failure Surfacing**

In the list view, failed posts display with a red chip "[Failed]" and a (!) icon. A connection health banner appears at the top of the Planner if any social account has an expired token.

```
┌────────────────────────────────────────────────────────────────┐
│ ⚠  Your Instagram connection expired. Posts may not publish.  │
│    [Reconnect Instagram]                            [Dismiss]  │
├────────────────────────────────────────────────────────────────┤
│ Planner ...                                                     │
```

**Post Detail — Failure State**

```
┌─────────────────────────────────────────┐
│ [← Close]   Live Music Save the Date    │
│             Instagram · Feed · Failed    │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ ⚠  Publishing failed              │ │
│  │  The Instagram access token       │ │
│  │  has expired.                     │ │
│  │                                   │ │
│  │  [Reconnect Instagram]            │ │
│  │  [Retry this post]                │ │
│  │  [Download copy & image]          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  [Post copy — read-only]               │
│  [Media preview]                        │
│  [Reschedule]                           │
│                                         │
│  [Show publish details ▾] (collapsed)  │
│  (Raw provider error visible here      │
│   only after user expands)             │
└─────────────────────────────────────────┘
```

Actions:
- **Reconnect Instagram** → navigates to Connections page
- **Retry this post** → triggers immediate retry (with loading state on button)
- **Download copy & image** → downloads a zip with the post text and image file + a plain-text guide for manual posting

---

### 3f. Connecting a Social Account

**Connections Page**

```
┌────────────────────────────────────────────────────────────────┐
│ Connections                                                     │
│ Social account status                                          │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Facebook                                     ● Connected│ │
│  │  The Anchor                                              │ │
│  │  Token expires: 12 Apr 2026 (38 days)                    │ │
│  │                        [Disconnect]  [Refresh token]     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Instagram                                  ○ Not connected│ │
│  │  Requires Facebook Business account                       │ │
│  │                                       [Connect Instagram] │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Google Business Profile               ⚠ Expiring soon   │ │
│  │  The Anchor Cambridge                                     │ │
│  │  Token expires: 10 Mar 2026 (5 days)                      │ │
│  │                        [Disconnect]  [Reconnect now]      │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Connecting Instagram — Step by Step**

1. User taps [Connect Instagram]
2. Full-screen loading overlay: "Opening Facebook login…"
3. OAuth popup or redirect to Facebook
4. Facebook authorizes; user is redirected back with `?code=...`
5. Connection page shows: "Connecting Instagram…" spinner
6. On success: card updates to show ● Connected with page name and expiry
7. On failure: inline error within the card: "Connection failed. [Try again] or [Get help]"

---

## 4. Design System Specification

### 4.1 Design Tokens

#### Colour Palette (Semantic)

All token names use semantic intent, not visual description.

```
Surface
  --color-surface-default      #f8fafc    Slate 50  — page background
  --color-surface-card         #ffffff    White     — card/panel background
  --color-surface-overlay      #f1f5f9    Slate 100 — secondary panel, muted bg
  --color-surface-sidebar      #1e293b    Slate 800 — sidebar background
  --color-surface-inverted     #0f172a    Slate 900 — dark panel on light bg

Foreground
  --color-text-primary         #0f172a    Slate 900 — body text, labels
  --color-text-secondary       #475569    Slate 600 — supporting text, descriptions
  --color-text-muted           #94a3b8    Slate 400 — placeholder, disabled
  --color-text-inverted        #f8fafc    Slate 50  — text on dark surfaces
  --color-text-on-primary      #ffffff    White     — text on brand-blue buttons

Brand / Interactive
  --color-brand-primary        #2563eb    Blue 600  — primary CTA, links, active nav
  --color-brand-primary-hover  #1d4ed8    Blue 700  — hover on primary
  --color-brand-primary-light  #eff6ff    Blue 50   — primary chip background
  --color-brand-teal           #0f766e    Teal 700  — accent, stage numbers, focus ring
  --color-brand-navy           #1e293b    Slate 800 — secondary CTA, sidebar

Platform
  --color-platform-facebook    #1B4DB1    — Facebook platform accent
  --color-platform-facebook-bg #E8F1FF    — Facebook badge background
  --color-platform-instagram   #C2338B    — Instagram platform accent
  --color-platform-instagram-bg#FEE7F8    — Instagram badge background
  --color-platform-gbp         #1C7C43    — GBP platform accent
  --color-platform-gbp-bg      #EAF8ED    — GBP badge background

Semantic States
  --color-success              #16a34a    Green 600
  --color-success-bg           #f0fdf4    Green 50
  --color-success-border       #bbf7d0    Green 200
  --color-warning              #d97706    Amber 600
  --color-warning-bg           #fffbeb    Amber 50
  --color-warning-border       #fde68a    Amber 200
  --color-error                #dc2626    Red 600
  --color-error-bg             #fef2f2    Red 50
  --color-error-border         #fecaca    Red 200
  --color-info                 #0369a1    Sky 700
  --color-info-bg              #f0f9ff    Sky 50
  --color-info-border          #bae6fd    Sky 200

Border
  --color-border-default       #e2e8f0    Slate 200
  --color-border-focus         #2563eb    = brand-primary
  --color-border-strong        #94a3b8    Slate 400

Status Chips (for post publishing status)
  --color-status-draft-fg      #475569    Slate 600
  --color-status-draft-bg      #f1f5f9    Slate 100
  --color-status-scheduled-fg  #1d4ed8    Blue 700
  --color-status-scheduled-bg  #eff6ff    Blue 50
  --color-status-queued-fg     #92400e    Amber 800
  --color-status-queued-bg     #fef3c7    Amber 100
  --color-status-publishing-fg #92400e    Amber 800
  --color-status-publishing-bg #fef3c7    Amber 100
  --color-status-published-fg  #166534    Green 800
  --color-status-published-bg  #f0fdf4    Green 50
  --color-status-failed-fg     #991b1b    Red 800
  --color-status-failed-bg     #fef2f2    Red 50
```

#### Spacing Scale

Uses an 4px base unit. Token names map to rem values.

```
--space-0    0
--space-1    0.25rem  (4px)
--space-2    0.5rem   (8px)
--space-3    0.75rem  (12px)
--space-4    1rem     (16px)
--space-5    1.25rem  (20px)
--space-6    1.5rem   (24px)
--space-8    2rem     (32px)
--space-10   2.5rem   (40px)
--space-12   3rem     (48px)
--space-16   4rem     (64px)
--space-20   5rem     (80px)
--space-24   6rem     (96px)
```

Standard internal padding for cards: `--space-5` (20px) on mobile, `--space-6` (24px) on desktop.
Standard gap between form fields: `--space-4` (16px).
Standard section gap: `--space-8` (32px).

#### Type Scale

Two typefaces: Outfit (headings), Inter (body).

```
--text-xs      0.75rem  / 1rem     (12px/16px)   — meta, captions, chips
--text-sm      0.875rem / 1.25rem  (14px/20px)   — form labels, helper text, body
--text-base    1rem     / 1.5rem   (16px/24px)   — default body, card content
--text-lg      1.125rem / 1.75rem  (18px/28px)   — section headings
--text-xl      1.25rem  / 1.75rem  (20px/28px)   — page sub-headings
--text-2xl     1.5rem   / 2rem     (24px/32px)   — page headings (Outfit)
--text-3xl     1.875rem / 2.25rem  (30px/36px)   — display headings (Outfit)

Font weight: regular (400) for body, medium (500) for labels, semibold (600) for headings, bold (700) for display.
```

#### Border Radius

```
--radius-sm    0.25rem  (4px)   — small chips, tags
--radius-md    0.5rem   (8px)   — inputs, checkboxes
--radius-lg    0.75rem  (12px)  — cards, panels
--radius-xl    1rem     (16px)  — modals, drawers, large cards
--radius-2xl   1.5rem   (24px)  — review post cards, bottom sheets
--radius-full  9999px            — pill buttons, badges, avatars
```

**Decision**: All interactive components (buttons, inputs, selects) use `--radius-md`. Cards use `--radius-lg`. Modals and drawers use `--radius-xl`. Platform badges and status chips use `--radius-full`.

---

### 4.2 Component Inventory

#### Keep As-Is
- `Button` — well-structured with variants; remove the `gloss` variant (unused/decorative)
- `Card`, `CardHeader`, `CardContent`, `CardFooter` — functional
- `Dialog` — use Radix UI Dialog everywhere; remove custom portal modals
- `Sheet` — use for all drawers; remove custom `StatusDrawer` and `MediaSwapModal`
- `Tabs` — keep; refine active state styling
- `Skeleton` — keep; extend coverage
- `Tooltip` — keep; add to icon-only buttons throughout
- `Label`, `Input`, `Separator` — keep

#### Rebuild
- **`Sidebar`** — merge `Sidebar.tsx` and `app-sidebar.tsx` into a single component. Use Radix sidebar pattern with collapsible support. Add connection health badge to Connections nav item.
- **`MobileNav`** — replace Sheet-based hamburger with a fixed bottom navigation bar on mobile.
- **`StageAccordion`** — rebuild as a stepped linear wizard (`Stepper`) for Create flows. Replace allowMultipleOpen accordion with single-panel, step-by-step navigation with a progress indicator (numbered steps with completion marks).

#### Create New
- **`Textarea`** — shadcn-style component wrapping `<textarea>` with consistent border, radius, focus ring, disabled state, dark mode, and error state. Accepts `rows` and `maxLength` props.
- **`Select`** — shadcn-style component replacing all raw `<select>` elements. Uses Radix Select for keyboard nav and ARIA support.
- **`RadioGroup`** and **`RadioGroupItem`** — replace raw `<input type="radio">` instances for platform toggles and publish mode selection.
- **`Checkbox`** — replace raw `<input type="checkbox">` instances.
- **`StatusChip`** — standardised chip component accepting a `status` prop (draft/scheduled/queued/publishing/published/failed) and applying correct colour tokens automatically.
- **`PlatformBadge`** — standardised badge for Facebook/Instagram/GBP with platform colour and icon.
- **`ProgressStepper`** — linear step indicator for Create flows. Shows numbered steps, current step highlighted, completed steps with tick icon.
- **`EmptyState`** — standard empty state layout with an illustration slot, heading, description, and action button slot.
- **`ErrorState`** — standard error state layout with icon, plain-English message, and action button slot.
- **`BottomSheet`** — mobile-first bottom sheet using `Sheet` with `side="bottom"` and `rounded-t-2xl`. Handle drag gesture.
- **`ConnectionHealthBanner`** — dismissible warning banner for expired/expiring tokens. Appears at top of Planner page.
- **`PostCard`** — standardised card for rendering a single content item in review list, planner list, or post detail. Contains platform badge, status chip, media thumbnail, copy preview, and action buttons.

#### Retire
- Custom `StatusDrawer` (replace with `Sheet`)
- Custom `MediaSwapModal` portal (replace with `Dialog`)
- `app-sidebar.tsx` (merge functionality into rebuilt `Sidebar`)
- Orphaned `navigation.ts` (its `NAV_ITEMS` export is unused — delete and hardcode nav into the single sidebar component, or integrate with new nav config)

---

### 4.3 Interaction Patterns

#### Loading States

| Pattern | Use case | Implementation |
|---|---|---|
| Skeleton screen | Initial page load | `Skeleton` component; match shape of content |
| Inline spinner | Button action in progress | Spinner icon inside button; button disabled |
| Full-screen overlay | Modal data loading | Spinner + "Loading studio…" centred |
| Progress bar with message | AI generation | `GenerationProgress` (keep; fix the cap-at-90% bug) |
| Optimistic update | Approve draft | Immediately show "Approved" chip; revert on failure |
| Shimmer placeholder | Library image load | CSS shimmer on `<img>` before `onLoad` fires |

#### Optimistic Updates

When the user clicks "Approve" on a draft post:
1. Immediately update the UI to show "Approved" status chip (green).
2. Disable the Approve button.
3. Fire the server action in background.
4. On success: do nothing (already showing correct state).
5. On failure: revert chip to "Draft", re-enable button, show error toast.

When the user saves post copy:
1. Keep the textarea value as edited.
2. Show "Saving…" on the Save button.
3. On success: show toast "Post copy saved". Update baseline for isDirty calculation.
4. On failure: show error toast. Keep edited value so user does not lose changes.

#### Toast vs Inline Errors

| Error type | Pattern |
|---|---|
| Form validation (required field, invalid URL) | Inline, below the specific field |
| Server action failure (save failed, generate failed) | Toast (error variant) + inline error if recoverable |
| Publish failure (visible in Planner) | Persistent inline error banner on post detail |
| Token expiry (affects future publishes) | Persistent connection health banner on Planner |
| Global network error | Toast (error) with retry action |
| Success (save, approve, connect) | Toast (success variant) |

Toast duration: success = 4 seconds. Error = 8 seconds (user needs time to read and act).

---

### 4.4 Breakpoints and Layout Grid

```
xs    0px      — base (mobile portrait)
sm    480px    — mobile landscape
md    768px    — tablet portrait
lg    1024px   — tablet landscape / small desktop
xl    1280px   — desktop
2xl   1536px   — large desktop
```

**Mobile (xs–sm):**
- Full-width single column
- Bottom navigation bar (fixed, 64px tall, 5 items)
- No sidebar
- Create flows open as bottom sheet or full-screen page
- Post detail opens as full-screen page (navigated)

**Tablet (md):**
- Sidebar visible, icon-only collapsed by default (80px wide)
- Main content: single column with generous padding
- Create flows open as slide-over from right (Sheet, max-w-2xl)

**Desktop (lg+):**
- Sidebar expanded (260px) with labels
- Main content: up to 1200px max-width, centred
- Create flows: stay in-page or open as modal (max-w-4xl)
- Planner post detail: side drawer (max-w-xl) rather than full navigation

**Layout Grid:**
- Gutter: `--space-6` (24px) at md+, `--space-4` (16px) at xs/sm
- Column count: 1 (mobile), 2 (tablet), 2-3 (desktop) depending on content
- Card grid for review list: 1 col (xs), 2 col (md), 3 col (xl)
- Settings form: 1 col (mobile), 2 col (md+)

---

## 5. Component Patterns

### 5.1 Form Layout and Validation Display

**Standard form field pattern:**

```tsx
<div className="space-y-2">
  <Label htmlFor="field-id">
    Field label
    {required && <span aria-hidden="true" className="text-error ml-1">*</span>}
  </Label>
  <p className="text-sm text-secondary" id="field-id-desc">
    Helper text (shown always if present)
  </p>
  <Input
    id="field-id"
    aria-describedby="field-id-desc field-id-error"
    aria-invalid={!!error}
    {...register("fieldName")}
  />
  {error && (
    <p id="field-id-error" className="text-sm text-error flex gap-1 items-center" role="alert">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {error.message}
    </p>
  )}
</div>
```

Rules:
- Error message always appears immediately below the field it relates to.
- Helper text above the input (between label and input) for context that aids filling the field.
- Helper text below the input only for post-fill information (character counts, format notes).
- `aria-invalid="true"` on the input when invalid.
- `aria-describedby` chains both helper text and error IDs.
- Error uses `role="alert"` so screen readers announce it on appearance.

**Form section grouping:**

```tsx
<fieldset>
  <legend className="text-lg font-semibold mb-4">Section heading</legend>
  <div className="space-y-4">
    {/* fields */}
  </div>
</fieldset>
```

All logically grouped form sections use `<fieldset>` + `<legend>`. Do not use `<div>` + `<h2>` for form sections.

**Submit button placement:**

- Always right-aligned at the bottom of the form.
- Destructive actions (Delete) left-aligned or separated visually.
- For multi-step forms, "Previous / Next" buttons at bottom with the step indicator above.

---

### 5.2 Platform-Specific Post Preview (Per-Tab Editor)

For the post detail screen and review list, each platform variant is presented as a card with a platform-specific header.

```
┌──────────────────────────────────┐
│ ● Facebook             Scheduled │  ← PlatformBadge + StatusChip
│ ┌──────────────────────────────┐ │
│ │  [media preview]             │ │  ← square for feed, 9:16 for story
│ └──────────────────────────────┘ │
│  [Swap media]                    │  ← action, top-right overlay on image
│                                  │
│  POST COPY              240 chars │  ← label + character count
│  ┌──────────────────────────────┐ │
│  │  Textarea (editable)         │ │
│  └──────────────────────────────┘ │
│                                  │
│  [Reset]          [Save copy]    │
│ ──────────────────────────────── │
│  [Approve]                       │  ← primary action
└──────────────────────────────────┘
```

Platform-specific constraints shown inline:
- Facebook: "Facebook posts · optimal 40–80 words" (character count in amber if over)
- Instagram: "Instagram · max 2,200 chars · first 125 chars shown before 'more'"
- GBP: "GBP updates · max 1,500 chars"

The character counter changes colour:
- Default: `--color-text-muted`
- Approaching limit (80%): `--color-warning`
- Over limit: `--color-error` + border turns red

---

### 5.3 Status Chips and Badges

**StatusChip component:**

```tsx
interface StatusChipProps {
  status: "draft" | "scheduled" | "queued" | "publishing" | "published" | "failed";
  size?: "sm" | "md";
}
```

Visual specification:

| Status | Text | Background | Border | Icon |
|---|---|---|---|---|
| draft | Draft | slate-100 | slate-200 | none |
| scheduled | Scheduled | blue-50 | blue-200 | CalendarCheck (12px) |
| queued | Queued | amber-100 | amber-200 | Clock (12px) |
| publishing | Publishing… | amber-100 | amber-200 | Loader2 animate-spin (12px) |
| published | Published | green-50 | green-200 | CheckCircle2 (12px) |
| failed | Failed | red-50 | red-200 | AlertCircle (12px) |

Chip height: 20px (sm), 24px (md). Radius: `--radius-full`. Padding: `px-2.5 py-1`. Font: 11px semibold uppercase tracking-wide.

**PlatformBadge component:**

```tsx
interface PlatformBadgeProps {
  platform: "facebook" | "instagram" | "gbp";
  showLabel?: boolean; // default true
}
```

Renders the platform colour dot + platform name (if `showLabel`) in the platform-specific colour.

---

### 5.4 Media Attachment Grid

**In Create forms — Attachment Selector:**

```
┌─────────────────────────────────────────────────────────┐
│ Media attachments                                        │
│ Pick processed images from your Library.                 │
│                                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────────────┐  │
│  │ img  │ │ img  │ │ img  │ │    + Add from library │  │
│  │  [x] │ │  [x] │ │  [x] │ │                      │  │
│  └──────┘ └──────┘ └──────┘ └──────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  [Upload new image]                              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

Thumbnail size: 80px × 80px. Tap [x] to deselect. Tap [+ Add from library] to open library picker (a Sheet/drawer, not a page navigation).

**Library Picker (in drawer):**

```
┌────────────────────────────────────┐
│ Select media         [Done (2)]    │
│ [All] [Images] [Videos]            │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐   │
│ │ ✓│ │  │ │  │ │ ✓│ │  │ │  │   │
│ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘   │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐   │
│ ...                                │
└────────────────────────────────────┘
```

Checkmarks overlaid on selected items. [Done (n)] shows count of selected items.

---

### 5.5 Empty State

Standard empty state component:

```
┌─────────────────────────────────────────┐
│                                         │
│         [Illustration / Icon]           │
│                                         │
│         No posts scheduled yet          │     ← heading, text-lg semibold
│                                         │
│   Your planner is empty. Create your    │     ← description, text-sm secondary
│   first post to get started.            │
│                                         │
│            [Create a post]              │     ← primary action button
│                                         │
└─────────────────────────────────────────┘
```

Props: `icon`, `heading`, `description`, `action` (ReactNode). The empty state is displayed for:
- Planner with no scheduled items
- Library with no uploaded assets
- Create form with no media in library
- Connections with no connected accounts

---

### 5.6 Error State with Actionable Recovery

Standard error state for page-level or section-level failures:

```
┌─────────────────────────────────────────┐
│                                         │
│  ⚠  Something went wrong               │     ← error icon + heading
│                                         │
│  We couldn't load your scheduled        │     ← plain-English description
│  posts. This is usually a connection    │     no raw error messages
│  issue.                                 │
│                                         │
│  [Try again]    [Contact support]       │     ← recovery actions
│                                         │
│  [Show details ▾]                       │     ← collapsed; reveals error code
│                                         │
└─────────────────────────────────────────┘
```

Rules:
- Never show raw API error messages, error codes, or stack traces as primary content.
- Always provide at least one recovery action.
- Technical details (error code, provider response) are available but collapsed behind "Show details".
- "Contact support" links to a mailto or help link.

---

## 6. Accessibility Requirements

### 6.1 WCAG 2.1 AA Checklist (App-Specific)

**Colour contrast:**
- All body text (16px regular): minimum 4.5:1 contrast ratio against background.
- Large text (18px+ or 14px+ bold): minimum 3:1.
- Status chips: verify text/background combinations for all six statuses. Current `--color-status-draft-fg` (#475569) on `--color-status-draft-bg` (#f1f5f9) = 5.03:1 — passes.
- Platform badges: verify all three. Current Facebook `#1B4DB1` on `#E8F1FF` = 7.2:1 — passes.
- The "muted" foreground `#94a3b8` on white (#ffffff) = 2.82:1 — **FAILS**. Use `#6b7280` (Gray 500, 4.48:1) for muted text on white backgrounds.

**Keyboard navigation:**
- All interactive elements reachable via Tab.
- Logical tab order: top-to-bottom, left-to-right within each region.
- No keyboard traps except inside open modals (where trap is intentional and Escape dismisses).
- Sidebar collapse button: focusable, has `aria-label="Collapse navigation"` / `"Expand navigation"`.
- Mobile bottom nav items: each has `aria-current="page"` when active.

**Focus management:**
- **Dialog/Modal**: On open, focus moves to the first focusable element inside the dialog (or the close button if no form field). On close, focus returns to the trigger element.
- **Bottom Sheet (Create flow)**: On open, focus moves to the sheet heading. On close, returns to the trigger.
- **Status Drawer**: On open, focus moves to the close button. On close, returns to the "Live activity" button.
- **Post Detail Drawer**: On open, focus moves to the heading or first interactive element. Tab cycles within the drawer. Escape closes.
- **Stepper navigation (Create Wizard)**: When advancing to the next step, scroll to top and focus the new step's heading (`h2`).

**ARIA patterns:**

| Component | Required ARIA |
|---|---|
| Sidebar nav | `<nav aria-label="Main navigation">`, `aria-current="page"` on active item |
| Bottom nav | `<nav aria-label="Mobile navigation">`, `aria-current="page"` on active item |
| Status chips | `role="status"` if updated dynamically |
| Platform badges | `aria-label="Facebook"` (or platform name) when icon-only |
| Progress bar | `role="progressbar"` `aria-valuenow={value}` `aria-valuemin="0"` `aria-valuemax="100"` `aria-label="Generating posts"` |
| Calendar grid | `<table>` with `scope="col"` on day headers. Each cell: `<td aria-label="Wednesday 5 March, 2 posts scheduled">` |
| List view posts | `<ul>` with `<li>` per post group; each post `<article>` |
| Modal | `role="dialog"` `aria-modal="true"` `aria-labelledby` pointing to modal title |
| StageAccordion triggers | `aria-expanded={isOpen}` `aria-controls={panelId}` |
| Form errors | `role="alert"` `aria-live="assertive"` |
| Form success | `role="status"` `aria-live="polite"` |
| Toasts | `role="status"` for success, `role="alert"` for errors |
| Connection health banner | `role="alert"` |

**Calendar/Planner keyboard navigation:**
- Arrow keys navigate between days in calendar grid.
- Enter or Space on a day cell opens the post creation bottom sheet.
- Enter or Space on a post dot/chip opens the post detail drawer.
- Escape from any drawer/sheet returns focus to the calendar cell that triggered it.
- Page Up / Page Down navigate between months.
- Home/End move to first/last day of the visible week.

**Form accessibility:**
- All inputs have a visible `<label>` (not placeholder-only).
- Required fields have `aria-required="true"` and a visible indicator (asterisk with `.sr-only` explanation: "fields marked with * are required").
- Error messages linked to inputs via `aria-describedby`.
- Disabled fields have `aria-disabled="true"` AND are visually distinct (reduced opacity, cursor not-allowed).
- The timezone field that is permanently disabled needs `aria-disabled="true"` and a visible note explaining why it cannot be changed.

**Motion / animation:**
- All Framer Motion animations respect `prefers-reduced-motion` media query. When reduced motion is preferred, use instant transitions (duration 0) or simple fade instead of slide/scale animations.
- Progress bar increment animation: use `transition: none` when reduced motion is preferred.

**Touch targets (mobile):**
- Minimum touch target size: 44×44px for all interactive elements.
- Current "Add post" calendar button (`Plus size={14}`) inside `rounded-full p-1` = approximately 22px — **FAILS**. Must increase to `p-2.5` minimum.
- Current `AddToCalendarButton` in `planner-interaction-components.tsx:29`: `p-1` with 14px icon = ~22px target — **FAILS**. Needs `p-2` minimum.
- Mobile nav items in `MobileNav` Sheet: `px-3 py-2` = approximately 36px tall — **borderline**. Increase to `py-3` (minimum 44px).
- Platform toggle buttons in Create forms: `Button` default height is `h-9` (36px) — **FAILS** on mobile. Use `h-11` (44px) on mobile.

**Screen reader announcements:**
- When generation completes, announce to screen readers: use `aria-live="polite"` region that updates with "Posts generated. Review and approve below."
- When a post is approved, announce: "Post approved and scheduled."
- When a connection token expires, the Planner banner uses `role="alert"` so it is announced on page load.

**Images:**
- All post media thumbnails: `alt` attribute with post title or "Post media for [campaign name]".
- UI icons: `aria-hidden="true"` when accompanied by visible text. `aria-label` when icon-only.
- Library asset grid: each image `alt` = file name or user-supplied tag.

---

*End of document. This specification is a planning artefact and does not modify any source files.*
