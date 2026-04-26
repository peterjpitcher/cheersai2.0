# Document Templates

These are the standard templates for each document type in the Obsidian vault. Use them as starting points — adapt content to the actual project, but keep the structure consistent.

Every template includes:
- **Mermaid diagram** placeholders for visual maps
- **Breadcrumb navigation** back to the parent MOC
- **Structured frontmatter** with prefixed tags and domain-specific fields
- **Callout blocks** (`> [!WARNING]`, `> [!TIP]`, etc.) where appropriate

---

## _Index.md (Master Dashboard)

```markdown
---
title: "[Project Name] Documentation"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/moc
  - status/active
---

# [Project Name]

> [One-line project description from CLAUDE.md or package.json]

## Architecture at a Glance

` ``mermaid
graph TD
  subgraph Frontend
    Pages[Next.js Pages]
    Components[React Components]
  end
  subgraph Server
    Middleware[Middleware]
    Actions[Server Actions]
    Routes[API Routes]
  end
  subgraph Data
    DB[(Supabase PostgreSQL)]
    Auth[Supabase Auth]
  end
  subgraph External
    API1[External API 1]
    API2[External API 2]
  end
  Pages --> Actions
  Pages --> Components
  Components --> Actions
  Actions --> DB
  Middleware --> Auth
  Actions --> API1
  Routes --> API2
` ``

## Quick Links

| Section | Entry Point | Description |
|---------|------------|-------------|
| Architecture | [[_Architecture MOC]] | Stack, deployment, routes, data flow, auth |
| Features | [[_Features MOC]] | All application features and user flows |
| Database | [[_Database MOC]] | Schema, RLS policies, migrations |
| API | [[_API MOC]] | Server actions, route handlers, integrations |
| Components | [[_Components MOC]] | UI component catalog and tree |
| Business Rules | [[_Business Rules MOC]] | Domain logic, policies, lifecycle rules |
| Health | [[_Health MOC]] | Optimization opportunities and tech debt |

## Features

| Feature | Status | Last Updated |
|---------|--------|-------------|
| [[Feature Name]] | current | YYYY-MM-DD |

## Recently Updated

1. [[Document]] — YYYY-MM-DD — Brief description of change

## Change Requests

Active: [[_Active]] (0 pending)

## Health Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Optimization | 0 | 0 | 0 | 0 |
| Tech Debt | 0 | 0 | 0 | 0 |

Last audit: YYYY-MM-DD | See [[Optimization Opportunities]] and [[Tech Debt]]

## Project Health

- **Last full sync**: YYYY-MM-DD
- **Drift status**: Clean / [N] items need attention
- **Documents**: [N] total
```

---

## Architecture/Route Map.md

```markdown
---
title: Route Map
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/architecture
  - status/active
related:
  - "[[Overview]]"
  - "[[Auth & Security]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Route Map

## Application Routes

` ``mermaid
graph LR
  subgraph Public Routes
    Login[/auth/login]
    ForgotPw[/auth/forgot-password]
    Confirm[/auth/confirm]
    UpdatePw[/auth/update-password]
  end
  subgraph Authenticated - All Roles
    Dashboard[/dashboard]
    Settings[/settings]
    Profile[/settings/profile]
  end
  subgraph Editor+ Routes
    Content[/content]
    ContentNew[/content/new]
    ContentEdit[/content/:id/edit]
  end
  subgraph Admin Routes
    AdminUsers[/admin/users]
    AdminInvite[/admin/invite]
  end
  Login -->|success| Dashboard
  ForgotPw -->|email sent| Login
  Confirm -->|invite| UpdatePw
  Confirm -->|recovery| UpdatePw
  UpdatePw -->|success| Dashboard
  Dashboard --> Content
  Dashboard --> Settings
  Settings --> Profile
  Content --> ContentNew
  Content --> ContentEdit
  Dashboard -->|admin| AdminUsers
  AdminUsers --> AdminInvite
` ``

## Route Details

| Route | Auth | Role | Component | Purpose |
|-------|------|------|-----------|---------|
| `/auth/login` | Public | — | `LoginPage` | Email/password sign-in |
| `/dashboard` | Required | viewer+ | `DashboardPage` | Main landing page |
| `/admin/users` | Required | admin | `UsersPage` | User management |

[Expand for every route in the project]

## Navigation Structure

[Describe the main navigation: sidebar items, header links, which sections are visible to which roles]
```

---

## Architecture/Overview.md

```markdown
---
title: Architecture Overview
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/architecture
  - status/active
related:
  - "[[Data Flow]]"
  - "[[Auth & Security]]"
  - "[[Route Map]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Architecture Overview

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | [version] |
| Language | TypeScript | strict mode |
| Styling | Tailwind CSS | [version] |
| Database | Supabase (PostgreSQL) | — |
| Auth | Supabase Auth + custom session | — |
| Hosting | Vercel | — |

## Project Structure

[Map the actual directory tree with annotations]

## Key Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| [package] | [what it does] | [any gotchas] |

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| [VAR_NAME] | [description] | yes/no |

## Key Architectural Decisions

[Major decisions with rationale — why this approach over alternatives]
```

---

## Architecture/Data Flow.md

```markdown
---
title: Data Flow
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/architecture
  - status/active
related:
  - "[[Overview]]"
  - "[[Schema]]"
  - "[[Server Actions]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Data Flow

## Request Lifecycle

` ``mermaid
sequenceDiagram
  participant Browser
  participant Middleware
  participant ServerComponent as Server Component
  participant ServerAction as Server Action
  participant Supabase
  Browser->>Middleware: HTTP Request
  Middleware->>Middleware: Session refresh (getUser)
  Middleware->>Middleware: Security headers
  Middleware->>Middleware: Auth gate
  Middleware->>ServerComponent: Authorized request
  ServerComponent->>Supabase: Data query (RLS)
  Supabase-->>ServerComponent: Data
  ServerComponent-->>Browser: Rendered HTML
  Note over Browser,Supabase: Mutation flow
  Browser->>ServerAction: Form submission
  ServerAction->>ServerAction: Auth check
  ServerAction->>ServerAction: Input validation (Zod)
  ServerAction->>Supabase: Mutation
  Supabase-->>ServerAction: Result
  ServerAction->>ServerAction: Audit log
  ServerAction->>ServerAction: revalidatePath()
  ServerAction-->>Browser: { success: true }
` ``

## Data Mutation Pattern

[How data changes flow through the system]

## Caching Strategy

[What's cached where: Next.js ISR, React Query, Supabase realtime]
```

---

## Architecture/Auth & Security.md

```markdown
---
title: Auth & Security
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/architecture
  - module/auth
  - status/active
typescript: src/middleware.ts
related:
  - "[[Overview]]"
  - "[[Server Actions]]"
  - "[[Route Handlers]]"
---

← [[_Index]] / [[_Architecture MOC]]

# Auth & Security

> [!NOTE]
> This project follows the workspace auth standard defined in `.claude/rules/auth-standard.md`. MixerAI2.0 is the canonical reference implementation.

## Middleware Pipeline

` ``mermaid
graph LR
  A[Request] --> B[Session Refresh]
  B --> C{Public Path?}
  C -->|Yes| D[Security Headers]
  C -->|No| E[Auth Gate]
  E -->|No session| F[Redirect to Login]
  E -->|Has session| G[Session Validation]
  G -->|Invalid| F
  G -->|Valid| H[CSRF Check]
  H -->|Mutation| I{Token Match?}
  I -->|No| J[403 Forbidden]
  I -->|Yes| D
  H -->|GET| D
  D --> K[Route Handler]
` ``

## Sign-in Flow

` ``mermaid
sequenceDiagram
  participant User
  participant Client
  participant Server
  participant Supabase
  participant SessionStore
  User->>Client: Enter email + password
  Client->>Client: Turnstile CAPTCHA
  Client->>Server: POST /api/auth/login
  Server->>Server: Check lockout
  Server->>Supabase: signInWithPassword()
  alt Success
    Supabase-->>Server: JWT
    Server->>SessionStore: createSession()
    Server-->>Client: Set cookies + redirect
  else Failure
    Server->>Server: Record failed attempt
    Server-->>Client: 401 (generic message)
  end
` ``

## RBAC

| Role | Level | Access |
|------|-------|--------|
| admin | 3 | Full platform access |
| editor | 2 | Content creation and editing |
| viewer | 1 | Read-only |

## Security Headers

[CSP policy, X-Frame-Options, HSTS — as configured in middleware]
```

---

## Database/Schema.md

```markdown
---
title: Database Schema
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/database
  - status/active
related:
  - "[[RLS Policies]]"
  - "[[Migrations]]"
---

← [[_Index]] / [[_Database MOC]]

# Database Schema

> [!WARNING]
> Always update this document when running migrations. Stale schema docs are worse than no schema docs — they mislead.

## Entity Relationship Diagram

` ``mermaid
erDiagram
  accounts ||--o{ content_items : "creates"
  accounts ||--o{ social_connections : "owns"
  accounts ||--|| brand_profile : "has"
  content_items ||--o{ publishing_jobs : "scheduled as"
  social_connections ||--o{ publishing_jobs : "published to"
` ``

## Tables

### [table_name]

[Brief purpose of this table]

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | no | gen_random_uuid() | Primary key |
| created_at | timestamptz | no | now() | Record creation time |

**Relationships:**
- `user_id` → `auth.users(id)` (foreign key, cascade delete)
- Referenced by: `[other_table].[column]`

**Indexes:**
- `idx_[table]_[column]` on `[column]` — [why this index exists]

**RLS:** See [[RLS Policies#table_name]]

[Repeat for each table]

## Type Mappings

[Document snake_case → camelCase conversions for key types]
```

---

## Features/[Feature Name].md

```markdown
---
title: "[Feature Name]"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current | in-development | deprecated
tags:
  - type/reference
  - section/features
  - module/[module-name]
  - status/active
module: [module-name]
route: /[primary-route]
table: [primary-table]
typescript: src/app/actions/[name].ts
related:
  - "[[Schema]]"
  - "[[Server Actions]]"
  - "[[_Business Rules MOC]]"
---

← [[_Index]] / [[_Features MOC]]

# [Feature Name]

## Purpose

[What this feature does and why it exists — 2-3 sentences]

## User Flow

` ``mermaid
graph TD
  A[User opens feature page] --> B[Data loads from server]
  B --> C{Has existing items?}
  C -->|Yes| D[Display item list]
  C -->|No| E[Show empty state]
  D --> F[User clicks create]
  E --> F
  F --> G[Form opens]
  G --> H[User submits]
  H --> I[Server action validates]
  I -->|Valid| J[Save to DB + revalidate]
  I -->|Invalid| K[Show validation errors]
  J --> D
` ``

## Key Files

| File | Role |
|------|------|
| `src/app/[route]/page.tsx` | Main page component |
| `src/components/[name].tsx` | [purpose] |
| `src/app/actions/[name].ts` | Server actions for this feature |

## Data Model

[Which database tables are involved — reference [[Schema]] for full details]

## Permissions

| Action | Required Role | Implementation |
|--------|--------------|----------------|
| View | viewer+ | RLS policy on [table] |
| Create | editor+ | Server action checks role |
| Delete | admin | Server action + confirmation dialog |

## Edge Cases & Known Limitations

[Document anything non-obvious]
```

---

## API/Server Actions.md

```markdown
---
title: Server Actions
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/api
  - status/active
related:
  - "[[Route Handlers]]"
  - "[[Schema]]"
---

← [[_Index]] / [[_API MOC]]

# Server Actions

## [Category/Feature]

### `actionName(params)`

- **File**: `src/app/actions/[file].ts`
- **Auth**: Required (viewer+ / editor+ / admin)
- **Params**: `{ paramName: Type, ... }`
- **Returns**: `Promise<{ success?: boolean; error?: string; data?: Type }>`
- **Side effects**: [Revalidates paths, sends emails, logs audit events]
- **Related**: [[Feature Name]]

[Repeat for each server action]
```

---

## API/External Integrations.md

```markdown
---
title: External Integrations
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/api
  - status/active
related:
  - "[[Overview]]"
  - "[[Data Flow]]"
---

← [[_Index]] / [[_API MOC]]

# External Integrations

## Integration Map

` ``mermaid
graph LR
  App[Application]
  App -->|Content generation| OpenAI[OpenAI API]
  App -->|Email delivery| Resend[Resend]
  App -->|Social publishing| Meta[Meta Graph API]
  App -->|Reviews| GBP[Google Business Profile]
  App -->|Auth tokens| Supabase[Supabase Auth]
` ``

## [Service Name]

- **Purpose**: [What this integration does]
- **Client file**: `src/lib/[service].ts`
- **Auth method**: API key / OAuth
- **Env vars**: `[VAR_NAME]`
- **Rate limits**: [Known limits]
- **Error handling**: [How failures are handled]

[Repeat for each service]
```

---

## Components/Component Index.md

```markdown
---
title: Component Index
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/components
  - status/active
related:
  - "[[Overview]]"
---

← [[_Index]] / [[_Components MOC]]

# Component Index

## Component Tree

` ``mermaid
graph TD
  RootLayout[Root Layout]
  RootLayout --> Sidebar[Sidebar Navigation]
  RootLayout --> Header[Header]
  RootLayout --> MainContent[Main Content Area]
  Sidebar --> NavItem[NavItem x N]
  MainContent --> DashboardPage[Dashboard Page]
  MainContent --> ContentPage[Content Page]
  ContentPage --> ContentList[ContentList]
  ContentPage --> ContentEditor[ContentEditor]
  ContentList --> ContentCard[ContentCard x N]
  ContentEditor --> RichTextEditor[RichTextEditor]
  ContentEditor --> MediaUploader[MediaUploader]
` ``

## Layout Components

| Component | File | Description |
|-----------|------|-------------|
| [Name] | `src/components/[path]` | [What it renders] |

## Feature Components

| Component | File | Feature | Server/Client |
|-----------|------|---------|---------------|
| [Name] | `src/components/[path]` | [[Feature]] | Server / Client |

## Shared/UI Components

| Component | File | Description |
|-----------|------|-------------|
| [Name] | `src/components/ui/[path]` | [What it does] |
```

---

## Health/Optimization Opportunities.md

```markdown
---
title: Optimization Opportunities
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/health
  - status/active
related:
  - "[[Tech Debt]]"
  - "[[Overview]]"
---

← [[_Index]] / [[_Health MOC]]

# Optimization Opportunities

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 0 | [performance, architecture] |
| MEDIUM | 0 | [performance, architecture] |
| LOW | 0 | [performance, architecture] |

## Performance

### OPT-001: [Brief title]

- **Severity**: HIGH / MEDIUM / LOW
- **Category**: Performance
- **Location**: `src/path/to/file.ts:LINE`
- **Issue**: [What's wrong and why it matters]
- **Impact**: [What happens if this isn't fixed — slowness, memory, user experience]
- **Fix**: [Specific recommendation with approach]
- **Effort**: XS / S / M / L
- **Status**: open | in-progress | fixed
- **Found**: YYYY-MM-DD
- **Fixed**: — (date when resolved)

[Repeat for each finding]

## Architecture

### OPT-002: [Brief title]

[Same structure as above]

## Hotspot Visualization

` ``mermaid
graph TD
  subgraph High Impact
    A[Content queries - no pagination]
    B[Publishing loop - N+1]
  end
  subgraph Medium Impact
    C[Dashboard - unnecessary client component]
    D[Settings - duplicated validation]
  end
  A -->|affects| E[Content List Page]
  A -->|affects| F[Content Search]
  B -->|affects| G[Publishing Queue]
  C -->|affects| H[Dashboard Load Time]
` ``
```

---

## Health/Tech Debt.md

```markdown
---
title: Technical Debt Tracker
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/health
  - status/active
related:
  - "[[Optimization Opportunities]]"
  - "[[Overview]]"
---

← [[_Index]] / [[_Health MOC]]

# Technical Debt Tracker

## Summary

| Severity | Count | Top Categories |
|----------|-------|---------------|
| CRITICAL | 0 | [security] |
| HIGH | 0 | [code-quality, security] |
| MEDIUM | 0 | [code-quality, testing] |
| LOW | 0 | [cleanup, consistency] |

## Critical & High Priority

### TD-001: [Brief title]

- **Severity**: CRITICAL / HIGH
- **Category**: Security / Code Quality / Testing / Accessibility
- **Location**: `src/path/to/file.ts:LINE`
- **Issue**: [What's wrong]
- **Risk**: [What could go wrong if this isn't addressed]
- **Fix**: [Specific recommendation]
- **Effort**: XS / S / M / L
- **Status**: open | in-progress | fixed
- **Found**: YYYY-MM-DD
- **Fixed**: — (date when resolved)

## Medium Priority

### TD-002: [Brief title]

[Same structure]

## Low Priority

### TD-003: [Brief title]

[Same structure]

## TODOs Found in Code

These were extracted from comments in the codebase:

| File | Line | Comment | Severity |
|------|------|---------|----------|
| `src/path/file.ts` | 42 | `// TODO: add pagination` | MEDIUM |
| `src/path/other.ts` | 18 | `// FIXME: race condition` | HIGH |
| `src/path/temp.ts` | 7 | `// HACK: temporary workaround` | MEDIUM |

## Resolved Debt

| ID | Title | Fixed Date | Resolution |
|----|-------|-----------|------------|
| — | — | — | — |
```

---

## Change Log/[YYYY-MM-DD].md

```markdown
---
title: "Change Log — YYYY-MM-DD"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/log
  - status/active
---

← [[_Index]]

# Changes — YYYY-MM-DD

### [HH:MM] — [Brief description]

- **What changed**: [1-2 sentences describing the change]
- **Files affected**: `path/to/file.ts`, `path/to/other.ts`
- **Docs updated**: [[Document Name]], [[Other Document]]
- **Health findings**: [Any new optimization/debt items found, or "none"]
- **Triggered by**: Code change / Change request / Initialization

---

[Repeat for each change entry, most recent first]
```

---

## Change Requests/_Active.md

```markdown
---
title: Active Change Requests
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - status/active
---

← [[_Index]]

# Active Change Requests

## Pending

| # | Request | Source | Complexity | Status |
|---|---------|--------|-----------|--------|
| 1 | [Brief description] | [[Source Document#section]] | S/M/L | pending |

## Details

### CR-1: [Brief description]

- **Source**: Found in [[Source Document]] under [section]
- **Full request**: [The complete text of the change request]
- **Scope**: [Which files/features need to change]
- **Complexity**: [XS/S/M/L/XL with reasoning]
- **Dependencies**: [Other CRs that must be done first, or none]
- **Status**: pending / in-progress / completed / deferred

## Completed

| # | Request | Completed | Change Log |
|---|---------|-----------|------------|
| — | — | — | — |
```

---

## Section MOC Template (used for all section hubs)

```markdown
---
title: "[Section Name] — Map of Content"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/moc
  - section/[section-name]
  - status/active
related:
  - "[[_Index]]"
---

← [[_Index]]

# [Section Name]

[2-3 sentence overview of what this section covers]

## Documents in This Section

` ``dataview
TABLE status, last_updated
FROM "Obsidian/[Section]"
WHERE file.name != "_[Section] MOC"
SORT last_updated DESC
` ``

## Section Overview

[Mermaid diagram appropriate to the section — e.g., ER diagram for Database, route map for Architecture, component tree for Components]

## Related Sections

- [[_Features MOC]] — [how this section relates to features]
- [[_API MOC]] — [how this section relates to APIs]
```

**Example — Features MOC:**

```markdown
---
title: "Features — Map of Content"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/moc
  - section/features
  - status/active
related:
  - "[[_Index]]"
  - "[[_API MOC]]"
  - "[[_Business Rules MOC]]"
---

← [[_Index]]

# Features

This section documents each user-facing feature with its purpose, user flow, key files, data model, and permissions.

## All Features

` ``dataview
TABLE status, module, last_updated
FROM "Obsidian/Features"
WHERE file.name != "_Features MOC"
SORT last_updated DESC
` ``

## Feature Map

` ``mermaid
graph TD
  subgraph Core Features
    Auth[Authentication]
    Dashboard[Dashboard]
  end
  subgraph Content
    Editor[Content Editor]
    Library[Content Library]
    Publishing[Publishing]
  end
  subgraph Admin
    Users[User Management]
    Settings[System Settings]
  end
  Auth --> Dashboard
  Dashboard --> Library
  Library --> Editor
  Editor --> Publishing
  Dashboard --> Users
  Dashboard --> Settings
` ``

## Related Sections

- [[_API MOC]] — Server actions that power these features
- [[_Database MOC]] — Data models underlying each feature
- [[_Business Rules MOC]] — Domain rules governing feature behavior
```

---

## Business Rules/[Domain Area].md

```markdown
---
title: "[Domain Area] — Business Rules"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/reference
  - section/business-rules
  - module/[module-name]
  - status/active
module: [module-name]
related:
  - "[[_Business Rules MOC]]"
  - "[[Feature Name]]"
---

← [[_Index]] / [[_Business Rules MOC]]

# [Domain Area] — Business Rules

## Overview

[2-3 sentences describing this domain area and why these rules exist]

## Rules

### BR-001: [Rule Name]

- **Rule**: [Clear statement of the business rule in plain English]
- **Rationale**: [Why this rule exists — business context]
- **Implementation**: `src/path/to/file.ts` — [how it's implemented in code]
- **Exceptions**: [Any exceptions or edge cases]
- **Owner**: [Who decides if this rule changes — product, legal, ops]

> [!WARNING]
> [Any critical caveats about this rule — e.g., "Changing this requires updating the Terms of Service"]

### BR-002: [Rule Name]

[Same structure]

## Lifecycle / State Machine

[If the domain has states (e.g., booking: pending → confirmed → checked-in → completed → cancelled), document them with a Mermaid state diagram:]

` ``mermaid
stateDiagram-v2
  [*] --> Pending: User creates
  Pending --> Confirmed: Payment received
  Pending --> Cancelled: User cancels / Timeout
  Confirmed --> CheckedIn: Staff marks arrival
  Confirmed --> Cancelled: User cancels (refund rules apply)
  CheckedIn --> Completed: Event ends
  Completed --> [*]
  Cancelled --> [*]
` ``

## Validation Rules

| Field | Rule | Error Message |
|-------|------|---------------|
| [field] | [validation] | [user-facing message] |

## Related

- [[Feature Name]] — Feature that implements these rules
- [[Schema#table_name]] — Database tables storing this data
- [[Server Actions]] — Actions that enforce these rules
```

---

## Business Rules/_Business Rules MOC.md

```markdown
---
title: "Business Rules — Map of Content"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: current
tags:
  - type/moc
  - section/business-rules
  - status/active
related:
  - "[[_Index]]"
  - "[[_Features MOC]]"
---

← [[_Index]]

# Business Rules

Business rules document the domain logic that exists independently of code architecture. These are the rules a product owner or business stakeholder would recognize — pricing, policies, lifecycle states, notification triggers, etc.

> [!TIP]
> When implementing a feature, check the relevant business rules document first. If a rule doesn't have a document yet, create one before coding — it clarifies requirements and catches edge cases early.

## All Business Rules

` ``dataview
TABLE module, last_updated
FROM "Obsidian/Business Rules"
WHERE file.name != "_Business Rules MOC"
SORT module ASC
` ``

## Related Sections

- [[_Features MOC]] — Features that implement these rules
- [[_Database MOC]] — Data models that store business data
- [[_API MOC]] — Server actions that enforce rules
```

---

Note: In the Mermaid code block examples above, the backtick sequences are shown with a space to avoid markdown parsing issues. When generating actual vault files, use proper triple-backtick fenced code blocks with `mermaid` as the language identifier.

In Dataview code block examples, the backtick sequences are also shown with a space. Use proper triple-backtick fenced code blocks with `dataview` as the language identifier.
