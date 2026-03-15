---
title: Architecture MOC
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/moc
  - section/architecture
---

← [[_Index]]

# Architecture

High-level technical architecture of CheersAI 2.0 — stack decisions, request flow, route map, and security model.

```mermaid
graph LR
  A[Overview] --> B[Data Flow]
  A --> C[Route Map]
  A --> D[Auth & Security]
```

## Documents

```dataview
TABLE status, last_updated
FROM "Obsidian/OJ-CheersAI2.0/Architecture"
WHERE file.name != "_Architecture MOC"
SORT last_updated DESC
```

## Related

- [[_Database MOC]] — Underlying schema
- [[_API MOC]] — Server actions and routes
- [[_Features MOC]] — Feature behaviour
