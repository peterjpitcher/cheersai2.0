import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every server path that creates content, uses AI, uploads media or starts
 * publishing must check the brand's entitlement (spec §4.1, decision D3).
 * This fails if a guard is removed or renamed. When adding such an action,
 * guard it with requireEntitledContext() and list it here.
 *
 * Not yet guarded (only brands with those feature switches can reach them,
 * today only comped brands): paid-ads campaign actions and tournament
 * actions. Guard them before either feature is offered to a paying brand.
 */
const GUARDED: Record<string, Record<string, 'create' | 'publish'>> = {
  'src/app/actions/ai-generate.ts': { generateContent: 'create', regenerateWithModifier: 'create' },
  'src/app/actions/content.ts': {
    createDraft: 'create',
    saveDraft: 'create',
    scheduleContent: 'publish',
    approveForQueue: 'publish',
    createScheduledBatch: 'publish',
  },
  'src/app/(app)/planner/actions.ts': {
    approveDraftContent: 'publish',
    updatePlannerContentMedia: 'create',
    restorePlannerContent: 'create',
    updatePlannerContentBody: 'create',
    updatePlannerContentSchedule: 'publish',
    createPlannerContent: 'create',
    updatePlannerBannerConfig: 'create',
  },
  'src/app/(app)/library/actions.ts': {
    requestMediaUpload: 'create',
    finaliseMediaUpload: 'create',
    updateMediaAsset: 'create',
    autoNameAndTagMediaAsset: 'create',
    replaceMediaAssetEverywhere: 'create',
  },
  'src/app/actions/media.ts': { uploadMediaAction: 'create', updateMediaTags: 'create', attachMediaToContent: 'create' },
  'src/app/(app)/create/template-actions.ts': { saveTemplate: 'create' },
  'src/app/actions/publish.ts': { retryPublishJob: 'publish' },
  'src/lib/link-in-bio/profile.ts': {
    upsertLinkInBioProfile: 'create',
    createLinkInBioTile: 'create',
    updateLinkInBioTile: 'create',
    reorderLinkInBioTiles: 'create',
  },
};

function functionBody(source: string, name: string): string | null {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) return null;
  const next = source.indexOf('\nexport ', start + 10);
  return source.slice(start, next < 0 ? undefined : next);
}

describe('billing entitlement guards', () => {
  const root = path.resolve(__dirname, '../../..');
  for (const [file, functions] of Object.entries(GUARDED)) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const [name, capability] of Object.entries(functions)) {
      it(`${file} ${name} checks '${capability}'`, () => {
        const body = functionBody(source, name);
        expect(body, `${name} not found in ${file}`).not.toBeNull();
        expect(body).toContain(`requireEntitledContext('${capability}')`);
      });
    }
  }
});
