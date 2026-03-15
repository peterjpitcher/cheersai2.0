---
title: Components MOC
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/moc
  - section/components
---

← [[_Index]]

# Components

UI component catalog for CheersAI 2.0.

## Component Organisation

Components follow a **feature-scoped** pattern — each feature has its own directory under `src/features/`. Shared/primitive components live in a `src/components/` directory (if present) or are imported from the UI library.

```mermaid
graph TD
  AppLayout["App Layout\nsrc/app/(app)/layout.tsx"]
  AppLayout --> Nav[Navigation\nNAV_ITEMS config]
  AppLayout --> PlannerPage[Planner Page]
  AppLayout --> CreatePage[Create Page]
  AppLayout --> LibraryPage[Library Page]
  AppLayout --> ConnectionsPage[Connections Page]
  AppLayout --> SettingsPage[Settings Page]

  PlannerPage --> PlannerCalendar
  PlannerPage --> ActivityFeed
  PlannerPage --> PlannerStatusFilters

  CreatePage --> CreateWizard
  CreateWizard --> InstantPostForm
  CreateWizard --> EventCampaignForm
  CreateWizard --> PromotionCampaignForm
  CreateWizard --> WeeklyCampaignForm
  CreateWizard --> StorySeriesForm
```

## Documents

```dataview
TABLE status, last_updated
FROM "Obsidian/OJ-CheersAI2.0/Components"
WHERE file.name != "_Components MOC"
SORT file.name ASC
```

## Related

- [[_Features MOC]]
- [[_Architecture MOC]]
