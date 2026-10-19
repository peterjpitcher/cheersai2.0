# Spec: story versions show the whole image

Owner approval: 20 October 2026 ("1 yes 2 yes"), after the planner showed a private hire story reading "ate Hire Booki".

## Problem
- Every image gets a 1080x1920 story version when it is uploaded (`src/lib/library/client-derivatives.ts`) or imported from the events system (`src/lib/management-app/artwork-image.ts`).
- Both made it by cropping the middle. A square image keeps only the middle 56% of its width, so designed graphics lose any words near their edges: "Beer battered cod & chips £16" became "ttered cod & chips £16".
- Photos survive a crop; designed graphics do not, and the owner uses many of them.

## Decisions
- A story version shows the whole image, centred, over a blurred and darkened copy of itself.
- An image already within 3% of the story shape (9:16) still fills the frame, losing a few pixels at most.
- One rule for both paths: `storyLayout()` in `src/lib/media/story-layout.ts`.
- Imported event artwork is unchanged when the events system supplies a designed upright version (it is story-shaped, so it fills the frame). The new rule applies only when an event has no upright design and the story is made from its square or landscape artwork.
- Existing images keep their story versions. The three graphics used in scheduled posts (cod and chips, spicy chicken stack, private hire) were given whole-image story versions on 20 October 2026, with the old crops kept in storage beside them (`temp/story-fit/swap-20261020.json` records the paths).

## Rollback
- Code: revert the PR. New uploads go back to cropping.
- Data: point each of the three graphics' `derived_variants.story` back at its old path (recorded in the swap file).

## Tests
- `storyLayout`: square, wide, 4:5 and 2:3 images fit whole; a story-shaped image fills the frame.
- Artwork import: a square artwork's story keeps its left edge and sits over a darker copy; a story-shaped artwork still fills the frame.
- Browser upload path: run in Chromium on 20 October 2026 with a red square and a blue left edge. The story was 1080x1920 with the blue edge intact and a darkened band above. A story-shaped image still filled the frame. Canvas cannot run in the Node test environment, so this was a one-off harness rather than a unit test.
