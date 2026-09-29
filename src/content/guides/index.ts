import type { Guide } from '@/content/guides/types';

/**
 * Every published guide.
 *
 * To add one: write `src/content/guides/<slug>.ts` exporting
 * `defineGuide({...})` (see types.ts for the fields), import it here and add
 * it to the list. `npm run test:ci` then checks it (dates, links, lengths, no
 * em dashes) along with the pages that show it.
 *
 * Empty until the keyword plan is done. With no guides, /guides is not found
 * and nothing links to it, even while the sign-up switch is on.
 */
const GUIDES: readonly Guide[] = [];

export function listGuides(): readonly Guide[] {
  return GUIDES;
}
