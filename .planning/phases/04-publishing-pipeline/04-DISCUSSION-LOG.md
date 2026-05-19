# Phase 4: Publishing Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 04-publishing-pipeline
**Areas discussed:** Approval & bulk approve flow

---

## Approval & Bulk Approve Flow

### Q1: Review Step Requirement

| Option | Description | Selected |
|--------|-------------|----------|
| Always required | Every piece of content passes through review before approval. Creates a deliberate checkpoint. | ✓ |
| Optional per content | Owner can choose to review first or approve immediately. Quick posts skip review; campaigns might warrant it. | |
| Auto-skip for instant posts | Instant posts go straight to approved after creation. Campaigns and recurring content require review. | |

**User's choice:** Always required
**Notes:** No exceptions — every content item must be reviewed before approval.

---

### Q2: Where Approval Happens

| Option | Description | Selected |
|--------|-------------|----------|
| Planner calendar | Owner taps a content item on the planner calendar to open detail drawer, then approves from there. | |
| Dedicated review queue | A new 'Review' tab or page listing all content awaiting approval. Batch-friendly workflow. | |
| Both | Review queue for batch work, planner detail drawer for individual items. Two entry points. | |

**User's choice:** "I should only review and approve content in the creation flow" (Other)
**Notes:** Approval is part of the create wizard, not a separate page or planner action. The review step is the preview of AI output within the creation flow.

---

### Q3: Bulk Approve

| Option | Description | Selected |
|--------|-------------|----------|
| Planner batch action | Multi-select mode on planner calendar. Owner selects pending items, hits 'Approve Selected'. | |
| Content list view | Filterable list view with checkboxes and 'Approve All' button at top. | |
| Both planner + list | Planner has 'Approve All This Week', content list has full multi-select. | |

**User's choice:** "Get rid of bulk approval" (Other)
**Notes:** Bulk approve (CONT-09) dropped entirely. Not needed since recurring campaigns auto-publish after first approval and individual content is approved in the create flow.

---

### Q4: Post-Approval Behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-queue at scheduled time | Approval + schedule time = done. QStash picks it up. If scheduled for now, publishes immediately. | ✓ |
| Confirmation step first | Summary card (platforms, time, preview) with 'Schedule' button before committing to pipeline. | |
| You decide | Claude has discretion on the UX between approve and queue. | |

**User's choice:** Auto-queue at scheduled time
**Notes:** No extra confirmation step. Approve in create flow → content is committed to the pipeline.

---

## Claude's Discretion

- Failure recovery UX (where failures surface, retry flow, plain-English error mapping)
- Preflight error presentation (blocking timing, fix-it CTAs, progressive vs all-at-once)
- Publishing status visibility (7-state machine in planner, real-time feedback)
- All technical implementation decisions (QStash dispatch, idempotency, retry/backoff, logging, testing)

## Deferred Ideas

- Bulk approve (CONT-09) — dropped by user decision, not deferred to a future phase
