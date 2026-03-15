---
title: Features MOC
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/moc
  - section/features
---

← [[_Index]]

# Features

Feature-by-feature documentation of CheersAI 2.0.

```mermaid
graph TD
  Create[Content Creation\n& Campaigns] --> Planner[Planner\nCalendar]
  Planner --> Publishing[Publishing\nPipeline]
  Library[Media Library] --> Create
  Connections[Social Connections] --> Publishing
  Settings[Settings &\nBrand Voice] --> Create
  Reviews[GBP Reviews] --> Connections
  LinkInBio[Link in Bio] --> Settings
```

## Documents

```dataview
TABLE status, last_updated
FROM "Obsidian/OJ-CheersAI2.0/Features"
WHERE file.name != "_Features MOC"
SORT file.name ASC
```

## Related

- [[_Architecture MOC]]
- [[_API MOC]]
- [[_Business Rules MOC]]
