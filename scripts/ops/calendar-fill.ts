#!/usr/bin/env tsx
/**
 * Fills the posting calendar (tasks/SPEC-social-calendar-fill.md): one feed
 * post a day on Facebook and Instagram, each with its story, from the events
 * system and the venue subjects in calendar-fill-subjects.json.
 *
 * This file only parses arguments and wires the real clients. Every rule and
 * safety check lives in src/lib/content/calendar-fill*.ts, where it is tested.
 *
 * A plan run changes nothing. It writes the report for the owner and the plan
 * file into temp/calendar-fill/<time>/ (git-ignored). Only once the owner has
 * approved that list does --apply write it, skipping anything that has changed
 * since, and record what it did in applied.json beside the plan. --rollback
 * undoes what applied.json records. Run on Node 24 from the repo root with
 * .env.local; OPENAI_MODEL picks the copy model, as it does for the app.
 *
 *   npm run ops:calendar-fill -- --account <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--subjects <file>] [--out <dir>]
 *   npm run ops:calendar-fill -- --apply --plan <file>
 *   npm run ops:calendar-fill -- --rollback --plan <file>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import { DateTime } from 'luxon';

export interface FillArgs {
  mode: 'plan' | 'apply' | 'rollback';
  accountId: string | null;
  from: string | null;
  to: string | null;
  subjectsFile: string;
  planFile: string | null;
  outDir: string | null;
}

export const USAGE = [
  'Usage:',
  '  npm run ops:calendar-fill -- --account <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--subjects <file>] [--out <dir>]',
  '  npm run ops:calendar-fill -- --apply --plan <file>',
  '  npm run ops:calendar-fill -- --rollback --plan <file>',
].join('\n');

const DEFAULT_SUBJECTS = path.join('scripts', 'ops', 'calendar-fill-subjects.json');
/** The events list endpoint returns at most this many; a full page may be missing some. */
const EVENT_PAGE = 100;

export function parseArgs(argv: string[]): FillArgs {
  const args: FillArgs = { mode: 'plan', accountId: null, from: null, to: null, subjectsFile: DEFAULT_SUBJECTS, planFile: null, outDir: null };
  const modes = new Set<FillArgs['mode']>();
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
    else if (arg === '--from') args.from = value();
    else if (arg === '--to') args.to = value();
    else if (arg === '--subjects') args.subjectsFile = value();
    else if (arg === '--plan') args.planFile = value();
    else if (arg === '--out') args.outDir = value();
    else throw new Error(`Unknown option ${arg}.\n${USAGE}`);
  }
  if (modes.size > 1) throw new Error(`Choose --apply or --rollback, not both.\n${USAGE}`);
  args.mode = [...modes][0] ?? 'plan';
  if (args.mode === 'plan' && (!args.accountId || !args.from || !args.to)) throw new Error(`A plan run needs --account, --from and --to.\n${USAGE}`);
  if (args.mode !== 'plan' && !args.planFile) throw new Error(`--${args.mode} needs --plan <file>.\n${USAGE}`);
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: '.env.local' });

  // Imported after dotenv so the app's env module reads .env.local.
  const { createServiceSupabaseClient } = await import('@/lib/supabase/service');
  const { getManagementEventDetail, listManagementEvents } = await import('@/lib/management-app/client');
  const db = createServiceSupabaseClient();

  const managementConfig = async (accountId: string) => {
    const { data, error } = await db
      .from('management_app_connections')
      .select('base_url, api_key, enabled')
      .eq('account_id', accountId)
      .maybeSingle<{ base_url: string; api_key: string | null; enabled: boolean }>();
    if (error) throw new Error(`Could not read the management app connection: ${error.message}`);
    return data?.enabled && data.api_key?.trim() ? { baseUrl: data.base_url, apiKey: data.api_key.trim() } : null;
  };

  if (args.mode !== 'plan') {
    const apply = await import('@/lib/content/calendar-fill-apply');
    const planPath = path.resolve(args.planFile as string);
    const plan = apply.parseCalendarPlan(JSON.parse(readFileSync(planPath, 'utf8')));
    const recordPath = path.join(path.dirname(planPath), 'applied.json');
    const previous = existsSync(recordPath) ? (JSON.parse(readFileSync(recordPath, 'utf8')) as import('@/lib/content/calendar-fill-apply').AppliedRecord) : undefined;
    if (previous && previous.planId !== plan.planId) throw new Error(`${recordPath} belongs to another plan.`);

    if (args.mode === 'rollback') {
      if (!previous) throw new Error(`Nothing to undo: ${recordPath} does not exist.`);
      const outcome = await apply.rollbackCalendarPlan({ db, log: (line) => console.log(line) }, plan, previous);
      writeFileSync(path.join(path.dirname(planPath), 'rolled-back.json'), `${JSON.stringify(outcome, null, 2)}\n`);
      for (const item of outcome.skipped) console.log(`  left ${item.what}: ${item.reason}`);
      for (const item of outcome.failed) console.log(`  FAILED ${item.what}: ${item.error}`);
      const campaigns = previous.created.filter((entry) => entry.createdCampaign && entry.campaignId).map((entry) => entry.campaignId);
      if (campaigns.length) console.log(`Campaigns created by the run are left, now empty: ${campaigns.join(', ')}`);
      if (outcome.failed.length) process.exitCode = 1;
      return;
    }

    const config = await managementConfig(plan.accountId);
    const { importEventArtwork } = await import('@/lib/management-app/artwork-import');
    const outcome = await apply.applyCalendarPlan(
      {
        db,
        log: (line) => console.log(line),
        importArtwork: async ({ eventId, eventName }) => {
          if (!config) throw new Error('no management app connection for this brand');
          const result = await importEventArtwork({ supabase: db, config, accountId: plan.accountId, eventId, eventName, deadlineAt: Date.now() + 120_000 });
          if (!result.assetId || !['imported', 'reused', 'partial'].includes(result.status)) {
            throw new Error(result.warning ?? `the artwork import ended ${result.status}`);
          }
          return result.assetId;
        },
      },
      plan,
      previous,
    );
    writeFileSync(recordPath, `${JSON.stringify(outcome.record, null, 2)}\n`);
    const created = outcome.record.created.reduce((total, entry) => total + entry.contentItemIds.length, 0);
    const moved = outcome.record.moved.reduce((total, entry) => total + entry.contentItemIds.length, 0);
    console.log(`\nApplied: ${created} items created and ${moved} moved in total; ${outcome.skipped.length} parts left alone, ${outcome.failed.length} failed.`);
    for (const item of outcome.skipped) console.log(`  left ${item.what}: ${item.reason}`);
    for (const item of outcome.failed) console.log(`  FAILED ${item.what}: ${item.error}`);

    const problems = await apply.verifyAppliedPlan(db, plan, outcome.record);
    console.log(problems.length ? `\nRead back: ${problems.length} problems.` : '\nRead back: every created and moved post is as planned.');
    for (const problem of problems) console.log(`  ${problem.what}: ${problem.problem}`);
    console.log(`Record: ${recordPath}`);
    if (outcome.failed.length || problems.length) process.exitCode = 1;
    return;
  }

  const accountId = args.accountId as string;
  const lib = await import('@/lib/content/calendar-fill');
  const { renderCalendarReport } = await import('@/lib/content/calendar-fill-report');
  const allSubjects = JSON.parse(readFileSync(path.resolve(args.subjectsFile), 'utf8')) as Record<string, unknown>;
  const subjects = lib.calendarSubjectsSchema.parse(allSubjects[accountId] ?? {});
  const config = await managementConfig(accountId);
  if (!config) throw new Error('This brand has no management app connection, so its events cannot be read.');

  const plan = await lib.planCalendarFill(
    {
      db,
      log: (line) => console.log(line),
      listEvents: async ({ fromDate, toDate }) => {
        const events = await listManagementEvents(config, { fromDate, toDate, limit: EVENT_PAGE });
        if (events.length >= EVENT_PAGE) throw new Error(`The events system returned a full page of ${EVENT_PAGE} events, so some may be missing. Plan a shorter period.`);
        return events;
      },
      getEventDetail: ({ id, slug }) => getManagementEventDetail(config, id, { fallbackSlug: slug ?? undefined }),
    },
    { accountId, from: args.from as string, to: args.to as string, subjects },
  );

  const stamp = DateTime.now().setZone('Europe/London').toFormat('yyyyLLdd-HHmmss');
  const outDir = path.resolve(args.outDir ?? path.join('temp', 'calendar-fill', stamp));
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, 'plan.json');
  const reportPath = path.join(outDir, 'report.md');
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(reportPath, renderCalendarReport(plan));

  const slots = plan.batches.reduce((total, batch) => total + batch.slots.length, 0);
  console.log(`\nPlanned ${slots} new posts and ${plan.moves.length} time moves with ${plan.model}; ${plan.unfilled.length} days left empty. Nothing has been changed.`);
  console.log(`Report: ${reportPath}`);
  console.log(`Plan:   ${planPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
