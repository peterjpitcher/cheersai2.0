# Phase 3: Provider Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 03-provider-integration
**Areas discussed:** Connection health display, Content type mapping

---

## Connection Health Display

### Q1: Where should connection health status live in the app?

| Option | Description | Selected |
|--------|-------------|----------|
| Connections page only | Dedicated /connections page shows full health details. Sidebar just shows a nav link. | |
| Sidebar + connections page | Sidebar shows a compact health indicator that links to the full connections page for details. | ✓ |
| Dashboard widget + page | A health summary widget on the main dashboard plus the full connections page for management. | |

**User's choice:** Sidebar + connections page
**Notes:** None

### Q2: How detailed should the sidebar health indicator be?

| Option | Description | Selected |
|--------|-------------|----------|
| Single dot/icon | One indicator showing worst-case status across all providers. Minimal sidebar footprint. | |
| Per-platform dots | Three small dots/icons (FB, IG, GBP) each coloured independently. Owner sees at a glance which specific platform needs attention. | ✓ |
| Count badge | A notification-style badge showing the number of issues. No badge when all healthy. | |

**User's choice:** Per-platform dots
**Notes:** None

### Q3: What should the full connections page show per provider?

| Option | Description | Selected |
|--------|-------------|----------|
| Card per provider | Each provider gets a card showing: status dot, account name, last sync time, token expiry date, and a connect/reconnect button. | ✓ |
| Table/list view | All providers in a single table with columns: platform, account, status, expires, last activity, actions. | |
| You decide | Claude chooses the layout that fits best with the existing design system. | |

**User's choice:** Card per provider
**Notes:** None

### Q4: Should the owner get a proactive nudge beyond the sidebar dots?

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar dots only | Owner notices status change next time they look at the sidebar. No additional notification. | |
| In-app toast on login | When the owner logs in and a connection is unhealthy, show a toast notification. One-time per session. | ✓ |
| Toast + email at 7 days | Toast on login plus an email alert when a token is 7 days from expiry. | |

**User's choice:** In-app toast on login
**Notes:** None

---

## Content Type Mapping

### Q1: When content targets a provider that can't support the content type, what should happen?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip silently | Adapter doesn't publish to that provider. Owner sees which platforms receive in create flow. | |
| Warn at create time | Show a warning during content creation. Owner decides whether to proceed. | ✓ |
| Auto-downgrade | Adapter converts to closest supported format. Owner told what happened after publish. | |

**User's choice:** Warn at create time
**Notes:** None

### Q2: Should the adapter interface expose provider-specific features or keep a flat common interface?

| Option | Description | Selected |
|--------|-------------|----------|
| Common interface only | All adapters expose same methods. Provider-specific types mapped internally. | |
| Common + extensions | Shared base interface plus optional provider-specific methods. Callers check capability. | ✓ |
| You decide | Claude picks the pattern that best fits existing codebase. | |

**User's choice:** Common + extensions
**Notes:** None

### Q3: For GBP's three post types, how should the owner select which type to create?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect from content | If content has event fields it becomes Event, offer fields become Offer, otherwise Standard. | |
| Explicit picker | Show a 'GBP post type' dropdown in the create flow when GBP is a target. | ✓ |
| Both | Auto-detect as default, owner can override via dropdown. | |

**User's choice:** Explicit picker
**Notes:** None

### Q4: Should each adapter validate content format before publish?

| Option | Description | Selected |
|--------|-------------|----------|
| Adapter validates | Each adapter has a validate(content) method checking platform-specific rules. Fails early. | ✓ |
| Phase 4 preflight | Adapters just publish. Preflight system in Phase 4 handles validation. | |
| Both layers | Adapters expose getConstraints(). Phase 4 preflight uses constraints. Adapters don't reject. | |

**User's choice:** Adapter validates
**Notes:** None

---

## Claude's Discretion

- OAuth connect flow UX details
- Error classification implementation
- Rate limit counter storage approach
- Nightly cron implementation details
- Token refresh retry strategy
- Registry pattern implementation

## Deferred Ideas

None — discussion stayed within phase scope
