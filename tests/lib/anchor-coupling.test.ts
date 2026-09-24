import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * New customers must never see The Anchor's name, links or invented social
 * proof, or be told CheersAI posts to Google Business Profile (removed). This
 * scans every non-test source file under src/ and fails on a match outside
 * the allow-list below.
 *
 * Every allow-listed file is either behind a per-brand feature switch that is
 * off for new customers (paid ads, tournaments, management import) or is
 * server-only ingest. Adding to this list needs the same justification.
 */
const PATTERN = /the-anchor|The Anchor|anchor\.pub|vip-club|Rose (&amp;|&) Crown|Sarah Mitchell|Google Business Profile/;

const ALLOWED: Record<string, string> = {
  'src/app/(app)/campaigns/actions.ts': 'paid ads (paidAds switch)',
  'src/app/(app)/campaigns/[id]/actions.ts': 'paid ads (paidAds switch)',
  'src/features/campaigns/CampaignBriefForm.tsx': 'paid ads (paidAds switch)',
  'src/lib/campaigns/generate.ts': 'paid ads (paidAds switch)',
  'src/lib/campaigns/management-tracking.ts': 'paid ads (paidAds switch)',
  'src/lib/campaigns/optimisation.ts': 'paid ads (paidAds switch)',
  'src/lib/campaigns/rewrite-copy.ts': 'paid ads (paidAds switch)',
  'src/lib/tournament/generate.ts': 'tournaments (tournaments switch)',
  'src/lib/tournament/overlay.ts': 'tournaments (tournaments switch)',
  'src/lib/ai/content-rules.ts': 'tournament-only menu-link rule (tournaments switch)',
  'src/lib/management-app/client.ts': 'management import (managementImport switch)',
  'src/lib/link-in-bio/public.ts': 'management events fallback (managementImport switch)',
  'src/app/api/booking-conversions/route.ts': 'server-only booking ingest default',
  'src/env.ts': 'comments on server-only settings',
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no Anchor-specific or stale copy outside gated features', () => {
  const root = path.resolve(__dirname, '../..');
  const files = listSourceFiles(path.join(root, 'src')).map((file) => path.relative(root, file).split(path.sep).join('/'));

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('only allow-listed files mention The Anchor, its links or Google Business Profile', () => {
    const offenders = files.filter(
      (file) => !(file in ALLOWED) && PATTERN.test(readFileSync(path.join(root, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-list honest (every entry still matches)', () => {
    const stale = Object.keys(ALLOWED).filter(
      (file) => !files.includes(file) || !PATTERN.test(readFileSync(path.join(root, file), 'utf8')),
    );
    expect(stale).toEqual([]);
  });
});
