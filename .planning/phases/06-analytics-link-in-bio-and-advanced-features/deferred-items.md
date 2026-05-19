# Deferred Items -- Phase 06

## Pre-existing Build Failures

1. **link-in-bio server import in client component** -- `src/features/link-in-bio/editor/link-in-bio-editor.tsx` imports `use-link-in-bio-editor.ts` which transitively imports `src/lib/auth/server.ts` (uses `next/headers`). This is a server-in-client import error from Plan 06-02, not caused by 06-03.
