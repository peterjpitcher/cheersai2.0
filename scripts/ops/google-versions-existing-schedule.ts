#!/usr/bin/env tsx
/**
 * The deliberate pass that gives posts already scheduled before Google was
 * connected their Google version (tasks/SPEC-gbp-posting-reintroduction.md,
 * decision D8). The cron only ever does this for posts created AFTER the
 * connection; everything older waits for this script (or the planner button
 * that the next piece adds).
 *
 * Dry run (the default): lists what would be created, what would be held for
 * a person and what would be skipped, with the reason, writes the plan to a
 * file under temp/, and changes nothing.
 *
 *   npm run ops:google-versions-existing-schedule -- --account <id>
 *
 * Apply: creates exactly the versions in that plan, only for posts unchanged
 * since the dry run, and needs the owner's own words of approval. A second
 * apply of the same plan creates nothing.
 *
 *   npm run ops:google-versions-existing-schedule -- --apply --plan <file> --asked "<owner's words>"
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import dotenv from "dotenv";
import { DateTime } from "luxon";

import type { GoogleVersionPlan, PlanEntry } from "@/lib/google-posts/create";

export interface ExistingScheduleArgs {
  mode: "plan" | "apply";
  accountId: string | null;
  planFile: string | null;
  asked: string | null;
  outDir: string | null;
}

export const USAGE = [
  "Usage:",
  "  npm run ops:google-versions-existing-schedule -- --account <id> [--out <dir>]",
  '  npm run ops:google-versions-existing-schedule -- --apply --plan <file> --asked "<owner\'s words>"',
].join("\n");

export function parseArgs(argv: string[]): ExistingScheduleArgs {
  const args: ExistingScheduleArgs = { mode: "plan", accountId: null, planFile: null, asked: null, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (): string => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value.\n${USAGE}`);
      index += 1;
      return next;
    };
    if (arg === "--apply") args.mode = "apply";
    else if (arg === "--dry-run") args.mode = "plan";
    else if (arg === "--account") args.accountId = value();
    else if (arg === "--plan") args.planFile = value();
    else if (arg === "--asked") args.asked = value();
    else if (arg === "--out") args.outDir = value();
    else throw new Error(`Unknown option ${arg}.\n${USAGE}`);
  }
  if (args.mode === "plan" && !args.accountId) throw new Error(`A dry run needs --account.\n${USAGE}`);
  if (args.mode === "apply") {
    if (!args.planFile) throw new Error(`--apply needs --plan <file> from a dry run.\n${USAGE}`);
    if (!args.asked?.trim()) throw new Error(`--apply needs --asked with the owner's words of approval.\n${USAGE}`);
  }
  return args;
}

function line(item: PlanEntry): string {
  const when = item.scheduledFor
    ? DateTime.fromISO(item.scheduledFor).setZone("Europe/London").toFormat("ccc d LLL yyyy HH:mm")
    : "no time";
  return `  ${when}  ${item.contentItemId}  ${item.reason}`;
}

export function renderPlan(plan: GoogleVersionPlan): string {
  const section = (title: string, items: PlanEntry[]): string[] =>
    items.length ? [`${title} (${items.length}):`, ...items.map(line), ""] : [`${title}: none`, ""];
  return [
    `Google versions for the existing schedule, brand ${plan.accountId}, location ${plan.localPostParent}`,
    `Planned at ${plan.generatedAt}. Nothing has been created.`,
    ...(plan.truncated
      ? ["WARNING: there are more upcoming posts than one pass reads; the latest ones are not in this plan. Apply it, then run the dry run again."]
      : []),
    "",
    ...section("Would be created", plan.create),
    ...section("Would be created but held for a person", plan.held),
    ...section("Skipped", plan.skipped),
    ...section("Left for later (management app call limit)", plan.deferred),
  ].join("\n");
}

export function parsePlan(raw: unknown): GoogleVersionPlan {
  const plan = raw as GoogleVersionPlan;
  if (!plan || typeof plan.accountId !== "string" || typeof plan.localPostParent !== "string" || !Array.isArray(plan.create) || !Array.isArray(plan.held)) {
    throw new Error("That file is not a plan from this script's dry run.");
  }
  return plan;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: ".env.local" });

  // Imported after dotenv so the app's env module reads .env.local.
  const lib = await import("@/lib/google-posts/create");

  if (args.mode === "apply") {
    const planPath = path.resolve(args.planFile as string);
    const plan = parsePlan(JSON.parse(readFileSync(planPath, "utf8")));
    const outcome = await lib.createGoogleVersionsForExistingSchedule(plan.accountId, plan);
    const report = {
      appliedAt: new Date().toISOString(),
      asked: args.asked,
      plan: planPath,
      created: outcome.created,
      alreadyHad: outcome.alreadyHad,
      changed: outcome.changed,
      failed: outcome.failed,
    };
    writeFileSync(path.join(path.dirname(planPath), `applied-${Date.now()}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Approval recorded: "${args.asked}"`);
    console.log(
      `Created ${outcome.created.length}; already had one ${outcome.alreadyHad.length}; changed since the dry run ${outcome.changed.length}; failed ${outcome.failed.length}.`,
    );
    for (const item of outcome.changed) console.log(`  not created ${item.contentItemId}: ${item.reason}`);
    for (const item of outcome.failed) console.log(`  FAILED ${item.contentItemId}: ${item.error}`);
    if (outcome.failed.length) process.exitCode = 1;
    return;
  }

  const plan = await lib.planGoogleVersionsForExistingSchedule(args.accountId as string);
  const stamp = DateTime.now().setZone("Europe/London").toFormat("yyyyLLdd-HHmmss");
  const outDir = path.resolve(args.outDir ?? path.join("temp", "google-versions-existing-schedule", stamp));
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(renderPlan(plan));
  console.log(`Plan: ${planPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
