# Changes Log — D6: Add preflight warning for missing creatives

## File modified
`src/app/(app)/campaigns/[id]/page.tsx`

## Changes made

### 1. Added `hasNoCreatives` boolean (after line 36, before `return`)
Computes `true` when:
- Campaign status is `DRAFT`
- At least one ad set exists
- Every ad across every ad set has neither `ad.mediaAssetId` nor `adSet.adsetMediaAssetId`

### 2. Added aggregate warning panel (after the publish error panel, before AI rationale)
Renders an amber-bordered panel when `hasNoCreatives` is `true`, informing the user that all ads are missing images and will be skipped during publishing.

## What was NOT changed
- The per-ad "No creative" amber badge at line 123 (now ~133) was left untouched.
- No other logic, styles, or components were modified.

## Location in file (after change)
- `hasNoCreatives` declaration: lines 38–44
- Warning panel JSX: inserted after the publish error panel (originally ending at line 79), before the AI rationale block
