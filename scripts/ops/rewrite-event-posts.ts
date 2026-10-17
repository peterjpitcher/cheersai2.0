#!/usr/bin/env tsx
/**
 * Rewrites the copy of already-scheduled event posts with the current copy
 * engine (tasks/SPEC-event-copy-engine.md B8).
 *
 * This file only parses arguments and wires the real clients. Everything else,
 * including every safety rule, lives in src/lib/content/rewrite-event-posts.ts,
 * where it is tested with mocks.
 *
 * A plan run changes no post. It writes the before-and-after report for the
 * owner and the plan file into temp/rewrite-event-posts/<time>/ (git-ignored).
 * Only once the owner has approved that list does --apply write exactly that
 * text, skipping any post edited, moved or published since. --rollback puts the
 * old text back on the same terms.
 *
 * Run it on Node 24 from the repo root with .env.local. OPENAI_MODEL picks the
 * model for a plan run, as it does for the app.
 * --note adds the owner's guidance to every brief in the run, as owner notes
 * typed in the wizard would be (use it with --campaign).
 *
 *   npm run ops:rewrite-event-posts -- --account <id> [--campaign <id> ...] [--note <text>]
 *   npm run ops:rewrite-event-posts -- --apply --plan <file>
 *   npm run ops:rewrite-event-posts -- --rollback --plan <file>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import { DateTime } from 'luxon';

export interface RewriteArgs {
  mode: 'plan' | 'apply' | 'rollback';
  accountId: string | null;
  campaignIds: string[];
  planFile: string | null;
  outDir: string | null;
  note: string | null;
}

export const USAGE = [
  'Usage:',
  '  npm run ops:rewrite-event-posts -- --account <id> [--campaign <id> ...] [--note <text>] [--out <dir>]',
  '  npm run ops:rewrite-event-posts -- --apply --plan <file>',
  '  npm run ops:rewrite-event-posts -- --rollback --plan <file>',
].join('\n');

export function parseArgs(argv: string[]): RewriteArgs {
  const args: RewriteArgs = { mode: 'plan', accountId: null, campaignIds: [], planFile: null, outDir: null, note: null };
  const modes = new Set<RewriteArgs['mode']>();
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
    else if (arg === '--campaign') args.campaignIds.push(value());
    else if (arg === '--plan') args.planFile = value();
    else if (arg === '--out') args.outDir = value();
    else if (arg === '--note') args.note = value();
    else throw new Error(`Unknown option ${arg}.\n${USAGE}`);
  }
  if (modes.size > 1) throw new Error(`Choose --apply or --rollback, not both.\n${USAGE}`);
  args.mode = [...modes][0] ?? 'plan';
  if (args.mode === 'plan' && !args.accountId) throw new Error(`A plan run needs --account.\n${USAGE}`);
  if (args.mode !== 'plan' && !args.planFile) throw new Error(`--${args.mode} needs --plan <file>.\n${USAGE}`);
  if (args.mode !== 'plan' && args.note) throw new Error(`--note only applies to a plan run.\n${USAGE}`);
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: '.env.local' });

  // Imported after dotenv so the app's env module reads .env.local.
  const { createServiceSupabaseClient } = await import('@/lib/supabase/service');
  const lib = await import('@/lib/content/rewrite-event-posts');
  const db = createServiceSupabaseClient();

  if (args.mode !== 'plan') {
    const plan = lib.parseRewritePlan(JSON.parse(readFileSync(args.planFile as string, 'utf8')));
    const outcome = await lib.applyRewritePlan(db, plan, { mode: args.mode });
    console.log(`${args.mode === 'apply' ? 'Applied' : 'Rolled back'}: ${outcome.written.length} written, ${outcome.skipped.length} left alone, ${outcome.failed.length} failed.`);
    for (const item of outcome.skipped) console.log(`  left alone ${item.contentItemId}: ${item.reason}`);
    for (const item of outcome.failed) console.log(`  FAILED ${item.contentItemId}: ${item.error}`);
    if (outcome.failed.length) process.exitCode = 1;
    return;
  }

  const accountId = args.accountId as string;
  const { getManagementEventDetail, listManagementEvents } = await import('@/lib/management-app/client');
  const { data: connection, error: connectionError } = await db
    .from('management_app_connections')
    .select('base_url, api_key, enabled')
    .eq('account_id', accountId)
    .maybeSingle<{ base_url: string; api_key: string | null; enabled: boolean }>();
  if (connectionError) throw new Error(`Could not read the management app connection: ${connectionError.message}`);
  const config = connection?.enabled && connection.api_key?.trim()
    ? { baseUrl: connection.base_url, apiKey: connection.api_key.trim() }
    : null;

  const plan = await lib.planEventPostRewrites(
    {
      db,
      log: (line) => console.log(line),
      findEvent: async ({ eventName, eventDate }) => {
        // Thrown, not swallowed: the report then says the facts were missing.
        if (!config) throw new Error('no management app connection for this brand');
        const events = await listManagementEvents(config, { query: eventName, limit: 50 });
        const chosen = lib.chooseManagementEvent(events, eventName, eventDate);
        return chosen ? getManagementEventDetail(config, chosen.id, { fallbackSlug: chosen.slug ?? undefined }) : null;
      },
    },
    { accountId, campaignIds: args.campaignIds, ownerNote: args.note ?? undefined },
  );

  const stamp = DateTime.now().setZone('Europe/London').toFormat('yyyyLLdd-HHmmss');
  const outDir = path.resolve(args.outDir ?? path.join('temp', 'rewrite-event-posts', stamp));
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, 'plan.json');
  const reportPath = path.join(outDir, 'report.md');
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(reportPath, lib.renderRewriteReport(plan));

  const posts = plan.slots.reduce((total, slot) => total + slot.posts.length, 0);
  console.log(`\nPlanned ${posts} posts in ${plan.slots.length} slots with ${plan.model}; ${plan.skipped.length} left alone. Nothing has been changed.`);
  console.log(`Report: ${reportPath}`);
  console.log(`Plan:   ${planPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
