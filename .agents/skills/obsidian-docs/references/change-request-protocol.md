# Change Request Protocol

This document covers the detailed protocol for finding, processing, and completing change requests that users leave in the Obsidian vault.

---

## How Users Express Intent

Users communicate desired changes by editing Obsidian documents. There are several patterns to recognize:

### Pattern 1: Inline Tags

Users wrap change requests in `#change-request` / `#end-change-request` tags:

```markdown
## Current Behavior

The dashboard shows total revenue for the current month.

#change-request
Add a comparison to the previous month — show the delta as a percentage
with a green/red indicator. Also add a sparkline for the last 6 months.
#end-change-request
```

The surrounding context matters — the request is about the dashboard revenue section specifically.

### Pattern 2: Section-Based

Users add a `## Change Requests` section (with unchecked markdown checkboxes):

```markdown
## Change Requests

- [ ] Add email notification when a new team member accepts their invite
- [ ] Show a "pending invites" count on the team management page
- [ ] Rate limit invite resends to max 3 per day per email
```

### Pattern 3: Inline Notes and Questions

Sometimes users leave notes that aren't formal change requests but signal intent. Look for:

- `TODO:` or `FIXME:` annotations
- Questions in the document: "Should this also handle...?"
- Strikethrough with replacement text: ~~old behavior~~ new behavior
- Comments wrapped in `%%` (Obsidian comment syntax): `%% This feels wrong, we should probably... %%`

For informal notes: surface them to the user and ask if they want to formalize them as change requests. Don't auto-implement.

### Pattern 4: New Documents

If the user creates a new document in `Features/` describing a feature that doesn't exist yet, treat the entire document as a feature specification / change request. The user is describing what they want built.

---

## Scanning Process

When scanning for change requests:

1. **Read every `.md` file** in the `Obsidian/` directory recursively
2. **Search for**:
   - `#change-request` tags (case-insensitive)
   - `## Change Requests` sections with unchecked `- [ ]` items
   - `TODO:` and `FIXME:` annotations
   - New feature documents that describe unimplemented functionality
3. **Collect** findings into `Change Requests/_Active.md`
4. **Preserve context** — note which document and section each request came from

---

## Prioritization

When multiple change requests exist, prioritize by:

1. **User-specified priority** — If the user has numbered or ordered them, respect that order
2. **Dependencies** — If CR-3 depends on CR-1, do CR-1 first regardless of other factors
3. **Complexity** — Start with smaller changes to build momentum and validate understanding
4. **Risk** — Database migrations and auth changes go last (they need more care)

---

## Implementation Protocol

### Before starting

1. Present all discovered change requests to the user with complexity estimates
2. Propose an implementation order
3. Wait for confirmation (the user may want to defer some, reorder, or clarify)

### During implementation

For each change request:

1. Create a mental model of what needs to change
2. Follow the project's CLAUDE.md and workspace standards
3. Make changes using the project's established patterns
4. Run the verification pipeline: lint → typecheck → test → build
5. Update the relevant Obsidian documentation to reflect the new reality

### After implementation

1. Mark the change request as completed:
   - For tag-based: Remove the `#change-request` / `#end-change-request` tags and replace with a completion note
   - For checkbox-based: Check the box and add completion date
2. Update `Change Requests/_Active.md` — move the item to the Completed section
3. Add a change log entry to `Change Log/[today].md`
4. Update any other affected documentation via the Sync workflow

---

## Edge Cases

### Conflicting change requests

If two change requests contradict each other (e.g., one says "add feature X" and another says "simplify by removing feature X"), do not implement either. Surface the conflict to the user and ask for resolution.

### Ambiguous change requests

If a change request is unclear about scope or behavior, check if the surrounding document context clarifies it. If not, ask the user one focused question to resolve the ambiguity. Don't guess — incorrect implementation wastes more time than asking.

### Change requests that conflict with existing standards

If a change request would violate the project's CLAUDE.md, workspace rules (auth-standard, testing, etc.), or security practices, flag the conflict:

```
⚠️ CR-2 asks to "skip auth check on the admin endpoint for faster development",
but this violates auth-standard.md Section 7 (RBAC). Server actions must always
re-verify auth server-side. Shall I implement the feature with proper auth checks
instead?
```

### Large change requests

If a change request is complexity score 4+ (L/XL), recommend breaking it into smaller increments before implementing. Reference the workspace's `complexity-and-incremental-dev.md` for the breakdown approach.

### Change requests about documentation itself

If the user's change request is about how documentation should be structured (not about code), apply it to the vault organization. These are meta-changes and should be treated as vault improvements.
