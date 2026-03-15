---
title: Database MOC
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/moc
  - section/database
---

← [[_Index]]

# Database

Supabase PostgreSQL schema, RLS policies, and migration history.

```mermaid
erDiagram
  accounts ||--o{ brand_profile : "has one"
  accounts ||--o{ posting_defaults : "has one"
  accounts ||--o{ social_connections : "owns"
  accounts ||--o{ media_assets : "uploads"
  accounts ||--o{ campaigns : "creates"
  accounts ||--o{ content_items : "owns"
  accounts ||--o{ notifications : "receives"
  accounts ||--o{ link_in_bio_profiles : "has one"
  campaigns ||--o{ content_items : "contains"
  content_items ||--o{ content_variants : "has"
  content_items ||--o{ publish_jobs : "spawns"
  media_assets ||--o{ content_variants : "referenced by"
```

## Documents

```dataview
TABLE status, last_updated
FROM "Obsidian/OJ-CheersAI2.0/Database"
WHERE file.name != "_Database MOC"
SORT last_updated DESC
```

## Related

- [[_Architecture MOC]]
- [[_API MOC]]
