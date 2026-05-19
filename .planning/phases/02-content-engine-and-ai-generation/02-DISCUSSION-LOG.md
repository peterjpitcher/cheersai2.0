# Phase 2: Content Engine and AI Generation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 02-content-engine-and-ai-generation
**Areas discussed:** Create flow steps, AI generation controls, Design system identity, Media library and upload

---

## Create Flow Steps

### Q1: How should the content creation flow be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-step wizard | Brief -> AI generates -> Review/edit per platform -> Schedule. Each step is a clear screen. v1 already uses this pattern. | ✓ |
| Single long form | Everything on one scrollable page. Simpler but potentially overwhelming. | |
| Two-phase | Phase 1: fill brief + settings. Phase 2: AI results + platform tabs + schedule. | |

**User's choice:** Multi-step wizard
**Notes:** Recommended option. Familiar to existing v1 users.

### Q2: What should the wizard steps be?

| Option | Description | Selected |
|--------|-------------|----------|
| 4 steps | 1) Pick type + write brief 2) AI generates — review/edit 3) Attach media 4) Schedule + confirm | ✓ |
| 3 steps | 1) Type + brief + media together 2) AI generates 3) Schedule. Faster but busier first step. | |
| 5 steps | 1) Pick type 2) Write brief + fine-tune 3) AI generates 4) Attach media 5) Schedule | |

**User's choice:** 4 steps
**Notes:** Clean separation of concerns.

### Q3: Should all five content types share the same wizard?

| Option | Description | Selected |
|--------|-------------|----------|
| Shared wizard, type-specific fields | Same 4-step structure. Step 1 adapts fields based on type. Consistent UX, less code. | ✓ |
| Separate flows per type | Each content type has its own dedicated form flow. More tailored but 5x UI code. | |
| Shared with branch at step 2 | Steps 1 and 3-4 shared. Step 2 has type-specific templates. | |

**User's choice:** Shared wizard, type-specific fields
**Notes:** Recommended option. Consistent UX.

### Q4: How should draft saving work during the wizard?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-save on step change | Draft saved to DB each time user advances a step. Resume where left off. | ✓ |
| Manual save button | Explicit 'Save Draft' button. Nothing saved until clicked. | |
| Save on exit only | Draft saved when user clicks 'Save & Close' or navigates away. | |

**User's choice:** Auto-save on step change
**Notes:** Recommended option. Prevents lost work.

---

## AI Generation Controls

### Q1: How should AI fine-tune controls be presented?

| Option | Description | Selected |
|--------|-------------|----------|
| Progressive disclosure | Sensible defaults with collapsible 'Advanced' panel. Most owners just click 'Generate'. | ✓ |
| Preset profiles | Named presets like 'Casual Friday', 'Weekend Special'. Owner picks a preset. | |
| Always visible controls | All fine-tune options visible from the start. No hiding. | |

**User's choice:** Progressive disclosure
**Notes:** Recommended option. Matches AI-02 requirement.

### Q2: What tone options should be available?

| Option | Description | Selected |
|--------|-------------|----------|
| Curated hospitality tones | 5-6 named tones: Friendly & Warm, Professional, Playful, Sophisticated, Community-focused | ✓ |
| Generic tone slider | Slider from 'Casual' to 'Formal' with numeric scale | |
| Free-text tone input | Owner types their own tone description | |

**User's choice:** Curated hospitality tones
**Notes:** Recommended option. Industry-specific language.

### Q3: How should regenerate-with-modifier work?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline modifier chips | Quick-action chips below output: 'Make shorter', 'More formal', etc. One click regenerates. | ✓ |
| Edit prompt and regenerate | Owner edits original brief or adds text instruction then regenerates. | |
| Both chips and text | Quick chips for common tweaks plus text field for custom instructions. | |

**User's choice:** Inline modifier chips
**Notes:** Recommended option. Fast iteration.

### Q4: How should per-platform AI output be shown?

| Option | Description | Selected |
|--------|-------------|----------|
| Tabbed preview | Tabs for Facebook, Instagram, GBP. Each tab shows generated copy with platform-styled preview. | |
| Side-by-side columns | All three platforms visible at once in columns. Good for comparison. | ✓ |
| Stacked cards | Vertically stacked cards, one per platform. Scrollable. | |

**User's choice:** Side-by-side columns
**Notes:** User preferred comparison view over tabbed. Will stack on mobile for responsiveness.

---

## Design System Identity

### Q1: What overall visual feel should v2 have?

| Option | Description | Selected |
|--------|-------------|----------|
| Clean & minimal | Generous whitespace, subtle shadows, restrained colour. Think Linear or Notion. | |
| Rich & detailed | More visual elements — gradients, illustrations, richer palette. | |
| Bold & branded | Strong brand colour presence, chunky elements, personality-driven. | ✓ |

**User's choice:** Bold & branded
**Notes:** User wants the platform to have character and personality.

### Q2: Should v2 support dark mode?

| Option | Description | Selected |
|--------|-------------|----------|
| Light only for v1 | Ship light mode only. Dark mode adds token/testing complexity. | |
| Dark mode from the start | Design tokens support both themes from day one. | ✓ |
| Auto based on system | Respect OS preference via prefers-color-scheme. | |

**User's choice:** Dark mode from the start
**Notes:** User considers dark mode essential, not a polish item.

### Q3: How should animations and transitions feel?

| Option | Description | Selected |
|--------|-------------|----------|
| Subtle micro-interactions | Smooth page transitions, hover states, loading skeletons. Framer Motion. | ✓ |
| Generous motion | Staggered list animations, slide-in panels, animated charts. | |
| Minimal / performance-first | Fade-in only for page loads. No complex animations. | |

**User's choice:** Subtle micro-interactions
**Notes:** Recommended option. Polished but not flashy.

### Q4: Card density in list views?

| Option | Description | Selected |
|--------|-------------|----------|
| Comfortable spacing | Generous padding, 2-3 cards per row on desktop. Easy to scan. | |
| Compact / dense | Tight padding, 4-5 cards per row. More items visible per screen. | ✓ |
| You decide | Claude picks appropriate density per view. | |

**User's choice:** Compact / dense
**Notes:** User wants to maximise visible content.

---

## Media Library and Upload

### Q1: How should media upload work during content creation?

| Option | Description | Selected |
|--------|-------------|----------|
| Drag-drop + browse + library picker | Drop zone, 'Browse' file picker, and 'Library' tab — all in one panel. | ✓ |
| Library-first | Default shows existing library. Upload button secondary. | |
| Upload-first | Default is upload zone. Library is secondary tab. | |

**User's choice:** Drag-drop + browse + library picker
**Notes:** Recommended option. All three in one panel.

### Q2: How should media tagging work?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual tags + auto-campaign link | Owner adds free-text tags. Auto-tagged with campaign name when attached. | ✓ |
| AI auto-tagging | AI suggests tags per upload. More automation but adds OpenAI cost. | |
| No tags | Search by filename/date only. Simplest but least discoverable. | |

**User's choice:** Manual tags + auto-campaign link
**Notes:** Recommended option.

### Q3: Where should uploaded media be stored?

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase Storage | Already in stack. RLS-protected, direct URL serving, image transforms. | ✓ |
| Vercel Blob | Simple blob storage. Good performance but new service dependency. | |
| You decide | Claude picks most pragmatic option. | |

**User's choice:** Supabase Storage
**Notes:** Recommended option. No new service dependency.

### Q4: Should media library have a standalone page?

| Option | Description | Selected |
|--------|-------------|----------|
| Both standalone + in-flow | Dedicated /library page plus inline picker in create wizard. | ✓ |
| Inline only | Media only accessible during content creation. No standalone page. | |
| Standalone only | Separate /library page. Wizard links to it but doesn't embed. | |

**User's choice:** Both standalone + in-flow
**Notes:** Recommended option. Matches CONT-07.

---

## Claude's Discretion

- Exact spacing token values (4px scale)
- Typography scale and heading hierarchy
- Loading skeleton designs
- Error state UI patterns
- Dark mode colour palette specifics
- Platform preview mockup fidelity
- Modifier chip set beyond the 4 examples
- Banner/overlay image generation approach

## Deferred Ideas

None — discussion stayed within phase scope.
