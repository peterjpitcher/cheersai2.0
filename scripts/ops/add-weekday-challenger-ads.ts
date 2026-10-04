#!/usr/bin/env tsx
/**
 * Adds one "walk in" challenger ad to each of the four weekday food campaigns for The Anchor
 * (tasks/SPEC-weekday-food-optimisation.md, section 7, C2).
 *
 * This file only parses arguments and wires the real clients. Everything else, including every
 * safety rule, lives in src/lib/campaigns/challenger-ads.ts, where whole runs are tested with
 * mocks.
 *
 * Run it only from the owner's Mac, from a checkout of main, with the repo's .env.local:
 *
 *   npm run ops:add-weekday-challengers                      (the same as --dry-run)
 *   npm run ops:add-weekday-challengers -- --status
 *   npm run ops:add-weekday-challengers -- --apply --confirmed owner-go-ahead,claims
 *   npm run ops:add-weekday-challengers -- --activate --confirmed <all seven checks>
 *   npm run ops:add-weekday-challengers -- --pause
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

import type { ChallengerMode } from '@/lib/campaigns/challenger-ads';

export interface ChallengerArgs {
  mode: ChallengerMode;
  /** Raw `--confirmed` values; the names are checked once the app modules are loaded. */
  confirmed: string[];
  stateDir: string | null;
  help: boolean;
}

const MODE_FLAGS = new Map<string, ChallengerMode>([
  ['--dry-run', 'dry-run'],
  ['--apply', 'apply'],
  ['--activate', 'activate'],
  ['--pause', 'pause'],
  ['--status', 'status'],
]);

export const USAGE = [
  'Usage: npm run ops:add-weekday-challengers -- [mode] [options]',
  '',
  'Modes (one only; --dry-run when none is given):',
  '  --dry-run    print everything it would do; write nothing',
  '  --apply      create the four challenger ads PAUSED',
  '  --activate   switch on the ads that passed every check',
  '  --pause      pause every challenger (rollback)',
  '  --status     read only: each challenger\'s stage, local and Meta status, and review state',
  '',
  'Options:',
  '  --confirmed <names>   checks a person has made, comma-separated',
  '                        (--apply needs owner-go-ahead,claims; --activate needs all seven)',
  '  --state-dir <path>    where the lock and manifests go (default: ~/.cheersai/weekday-challenger-ads)',
  '  --help                show this',
].join('\n');

export function parseArgs(argv: string[]): ChallengerArgs {
  const args: ChallengerArgs = { mode: 'dry-run', confirmed: [], stateDir: null, help: false };
  const modes: ChallengerMode[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const mode = MODE_FLAGS.get(arg);
    if (mode) {
      modes.push(mode);
    } else if (arg === '--confirmed') {
      args.confirmed.push(readValue(argv, index, '--confirmed'));
      index += 1;
    } else if (arg === '--state-dir') {
      args.stateDir = readValue(argv, index, '--state-dir');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  // Two modes at once is never guessed at: a typo must not turn a dry run into a write.
  if (new Set(modes).size > 1) {
    throw new Error(`Choose one mode only (got ${modes.map((mode) => `--${mode}`).join(' and ')}).`);
  }
  if (modes[0]) args.mode = modes[0];
  return args;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  // .env.local must be loaded before any app module is imported: src/env.ts reads the
  // environment once, when it is first loaded. Hence the imports below, inside main.
  const loaded = dotenv.config({ path: '.env.local', quiet: true });
  if (loaded.error) {
    throw new Error(
      `The repo's .env.local could not be read (${loaded.error.message}). Run this from the repository root on the owner's Mac. Nothing was read or written.`,
    );
  }

  const challenger = await import('@/lib/campaigns/challenger-ads');
  const files = await import('@/lib/campaigns/challenger-ads-files');
  const marketing = await import('@/lib/meta/marketing');
  const management = await import('@/lib/management-app/client');
  const { getMetaGraphVersion } = await import('@/lib/meta/graph');
  const { createServiceSupabaseClient } = await import('@/lib/supabase/service');

  const confirmed = challenger.parseConfirmed(args.confirmed);
  const stateDirectory = files.resolveStateDirectory(args.stateDir, process.cwd());

  const result = await challenger.runChallengerAds(
    { mode: args.mode, confirmed },
    {
      supabase: createServiceSupabaseClient(),
      meta: {
        fetchAdAccountSpendStatus: marketing.fetchMetaAdAccountSpendStatus,
        fetchAdSetBudgetRemaining: marketing.fetchMetaAdSetBudgetRemaining,
        listAdSetAds: marketing.listMetaAdSetAds,
        listAdCreativesNamed: marketing.listMetaAdCreativesNamed,
        readAdForLaunch: marketing.readMetaAdForLaunch,
        readAdCreative: marketing.readMetaAdCreative,
        uploadImage: marketing.uploadMetaImage,
        createAdCreative: marketing.createMetaAdCreative,
        createAd: marketing.createMetaAd,
        setObjectStatus: marketing.setMetaObjectStatus,
      },
      management: { createMetaAdsLink: management.createManagementMetaAdsLink },
      lock: files.createFileRunLock({ directory: stateDirectory }),
      writeManifest: files.createManifestWriter(stateDirectory),
      now: () => new Date(),
      log: (line) => console.log(line),
      runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
      graphVersion: getMetaGraphVersion(),
    },
  );

  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // The message only: never the error object or its stack, which could carry a request address.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
