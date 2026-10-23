#!/usr/bin/env tsx
/**
 * Names the event in the booking line of Instagram event posts already
 * scheduled (tasks/SPEC-instagram-booking-line-names-event.md).
 *
 * This file only parses arguments and wires the real client. Everything else,
 * including every safety rule, lives in src/lib/content/booking-line-backfill.ts,
 * where it is tested with mocks.
 *
 * A plan run changes no post. It writes the owner's list and the plan file into
 * temp/booking-line-backfill/<time>/ (git-ignored). Only once the owner has
 * approved that list does --apply write exactly those lines, skipping any post
 * edited, moved or published since. --rollback puts the old lines back on the
 * same terms.
 *
 * Run it on Node 24 from the repo root with .env.local.
 *
 *   npm run ops:booking-line-backfill -- --account <id> [--out <dir>]
 *   npm run ops:booking-line-backfill -- --apply --plan <file>
 *   npm run ops:booking-line-backfill -- --rollback --plan <file>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import { DateTime } from 'luxon';

export interface BackfillArgs {
  mode: 'plan' | 'apply' | 'rollback';
  accountId: string | null;
  planFile: string | null;
  outDir: string | null;
}

export const USAGE = [
  'Usage:',
  '  npm run ops:booking-line-backfill -- --account <id> [--out <dir>]',
  '  npm run ops:booking-line-backfill -- --apply --plan <file>',
  '  npm run ops:booking-line-backfill -- --rollback --plan <file>',
].join('\n');

export function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = { mode: 'plan', accountId: null, planFile: null, outDir: null };
  const modes = new Set<BackfillArgs['mode']>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (): string => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value.\n${USAGE}`);
      index += 1;
      return next;
    };
    if (arg === '--apply') modes.add('apply');
    else if (arg === '--rollback') modes.add('rollback');
    else if (arg === '--account') args.accountId = value();
    else if (arg === '--plan') args.planFile = value();
    else if (arg === '--out') args.outDir = value();
    else throw new Error(`Unknown option ${arg}.\n${USAGE}`);
  }
  if (modes.size > 1) throw new Error(`Choose --apply or --rollback, not both.\n${USAGE}`);
  args.mode = [...modes][0] ?? 'plan';
  if (args.mode === 'plan' && !args.accountId) throw new Error(`A plan run needs --account.\n${USAGE}`);
  if (args.mode !== 'plan' && !args.planFile) throw new Error(`--${args.mode} needs --plan <file>.\n${USAGE}`);
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: '.env.local' });

  // Imported after dotenv so the app's env module reads .env.local.
  const { createServiceSupabaseClient } = await import('@/lib/supabase/service');
  const lib = await import('@/lib/content/booking-line-backfill');
  const db = createServiceSupabaseClient();

  if (args.mode !== 'plan') {
    const plan = lib.parseBookingLinePlan(JSON.parse(readFileSync(args.planFile as string, 'utf8')));
    const outcome = await lib.applyBookingLinePlan(db, plan, { mode: args.mode });
    console.log(`${args.mode === 'apply' ? 'Applied' : 'Rolled back'}: ${outcome.written.length} written, ${outcome.skipped.length} left alone, ${outcome.failed.length} failed.`);
    for (const item of outcome.skipped) console.log(`  left alone ${item.contentItemId}: ${item.reason}`);
    for (const item of outcome.failed) console.log(`  FAILED ${item.contentItemId}: ${item.error}`);
    if (outcome.failed.length) process.exitCode = 1;
    return;
  }

  const plan = await lib.planBookingLineBackfill(db, { accountId: args.accountId as string });
  const stamp = DateTime.now().setZone('Europe/London').toFormat('yyyyLLdd-HHmmss');
  const outDir = path.resolve(args.outDir ?? path.join('temp', 'booking-line-backfill', stamp));
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, 'plan.json');
  const reportPath = path.join(outDir, 'report.md');
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(reportPath, lib.renderBookingLineReport(plan));

  console.log(`Planned ${plan.posts.length} booking lines; ${plan.skipped.length} posts left alone. Nothing has been changed.`);
  console.log(`Report: ${reportPath}`);
  console.log(`Plan:   ${planPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
