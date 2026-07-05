#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const DEFAULT_ACCOUNT_NAME = "The Anchor";
const DEFAULT_CUTOFF_DAYS = 30;
const CHUNK_SIZE = 100;

export const FAILURE_NOTIFICATION_CATEGORIES = [
  "publish_failed",
  "story_publish_failed",
  "publish_failed_immediate",
  "publish_retry",
  "story_publish_retry",
  "connection_needs_action",
] as const;

const RETRY_NOTIFICATION_CATEGORIES = new Set(["publish_retry", "story_publish_retry"]);
const FAILURE_CATEGORY_SET = new Set<string>(FAILURE_NOTIFICATION_CATEGORIES);

export interface CleanupArgs {
  execute: boolean;
  account: string;
  accountId?: string;
  cutoffDays: number;
}

export interface NotificationForCleanup {
  id: string;
  category: string;
  metadata: unknown;
  created_at: string;
  dismissed_at?: string | null;
}

export function parseArgs(argv: string[]): CleanupArgs {
  const args: CleanupArgs = {
    execute: false,
    account: DEFAULT_ACCOUNT_NAME,
    cutoffDays: DEFAULT_CUTOFF_DAYS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--dry-run") {
      args.execute = false;
    } else if (arg === "--account") {
      args.account = readValue(argv, index, "--account");
      index += 1;
    } else if (arg === "--account-id") {
      args.accountId = readValue(argv, index, "--account-id");
      index += 1;
    } else if (arg === "--cutoff-days") {
      const raw = readValue(argv, index, "--cutoff-days");
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--cutoff-days must be a positive integer.");
      }
      args.cutoffDays = parsed;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export function collectNotificationIdsToDismiss({
  notifications,
  archivedContentIds,
  activeJobIds,
  now,
  staleBefore,
}: {
  notifications: NotificationForCleanup[];
  archivedContentIds: Set<string>;
  activeJobIds: Set<string>;
  now: Date;
  staleBefore: Date;
}): string[] {
  const ids = new Set<string>();

  for (const notification of notifications) {
    if (notification.dismissed_at) continue;
    const metadata = asRecord(notification.metadata);
    const contentId = getString(metadata, "contentId") ?? getString(metadata, "content_item_id");
    const jobId = getString(metadata, "jobId") ?? getString(metadata, "publishJobId") ?? getString(metadata, "publish_job_id");
    const nextAttemptAt = getString(metadata, "nextAttemptAt");
    const createdAt = new Date(notification.created_at);
    const isOldProblem =
      FAILURE_CATEGORY_SET.has(notification.category) &&
      Number.isFinite(createdAt.getTime()) &&
      createdAt < staleBefore;
    const isArchivedPostAlert = Boolean(contentId && archivedContentIds.has(contentId));
    const isStaleRetry =
      RETRY_NOTIFICATION_CATEGORIES.has(notification.category) &&
      (!jobId || !activeJobIds.has(jobId) || isPastDate(nextAttemptAt, now));

    if (isArchivedPostAlert || isStaleRetry || isOldProblem) {
      ids.add(notification.id);
    }
  }

  return Array.from(ids);
}

type AccountRow = Record<string, unknown> & { id: string };
type ContentJoin = {
  id: string;
  status: string | null;
  deleted_at: string | null;
  platform: string | null;
  scheduled_for: string | null;
};
type PublishJobCleanupRow = {
  id: string;
  content_item_id: string | null;
  status: string;
  placement?: string | null;
  last_error?: string | null;
  error_message?: string | null;
  next_attempt_at?: string | null;
  updated_at?: string | null;
  content_items: ContentJoin | ContentJoin[] | null;
};

interface CleanupPlan {
  account: AccountRow;
  failedJobs: PublishJobCleanupRow[];
  gbpJobs: PublishJobCleanupRow[];
  failedContentIds: string[];
  gbpContentIds: string[];
  contentIdsToArchive: string[];
  activeJobIds: string[];
  notificationIdsToDismiss: string[];
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isPastDate(value: string | null, now: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date < now;
}

function normaliseContentJoin(value: ContentJoin | ContentJoin[] | null): ContentJoin | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function accountLabel(account: AccountRow): string {
  const businessName = typeof account.business_name === "string" ? account.business_name : "";
  const displayName = typeof account.display_name === "string" ? account.display_name : "";
  const email = typeof account.email === "string" ? account.email : "";
  return businessName || displayName || email || account.id;
}

function accountMatches(account: AccountRow, target: string): boolean {
  const lowerTarget = target.trim().toLowerCase();
  return [
    account.id,
    account.business_name,
    account.display_name,
    account.email,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.trim().toLowerCase() === lowerTarget);
}

async function loadAccount(supabase: SupabaseClient, args: CleanupArgs): Promise<AccountRow> {
  if (args.accountId) {
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", args.accountId)
      .maybeSingle<AccountRow>();
    if (error) throw error;
    if (!data) throw new Error(`Account not found: ${args.accountId}`);
    return data;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .limit(1000)
    .returns<AccountRow[]>();

  if (error) throw error;

  const matches = (data ?? []).filter((account) => accountMatches(account, args.account));
  if (matches.length !== 1) {
    throw new Error(`Expected one account named "${args.account}", found ${matches.length}. Use --account-id.`);
  }
  return matches[0];
}

async function loadCleanupPlan(supabase: SupabaseClient, args: CleanupArgs): Promise<CleanupPlan> {
  const account = await loadAccount(supabase, args);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - args.cutoffDays * 24 * 60 * 60 * 1000);

  const { data: failedJobs, error: failedError } = await supabase
    .from("publish_jobs")
    .select("id, content_item_id, status, placement, last_error, error_message, next_attempt_at, updated_at, content_items!inner(id, status, deleted_at, platform, scheduled_for)")
    .eq("account_id", account.id)
    .eq("status", "failed")
    .is("resolved_at", null)
    .is("content_items.deleted_at", null)
    .returns<PublishJobCleanupRow[]>();

  if (failedError) throw failedError;

  const { data: gbpJobs, error: gbpError } = await supabase
    .from("publish_jobs")
    .select("id, content_item_id, status, placement, last_error, error_message, next_attempt_at, updated_at, content_items!inner(id, status, deleted_at, platform, scheduled_for)")
    .eq("account_id", account.id)
    .in("status", ["queued", "scheduled", "in_progress"])
    .is("resolved_at", null)
    .is("content_items.deleted_at", null)
    .eq("content_items.platform", "gbp")
    .returns<PublishJobCleanupRow[]>();

  if (gbpError) throw gbpError;

  const failedContentIds = unique((failedJobs ?? []).map((job) => normaliseContentJoin(job.content_items)?.id));
  const gbpContentIds = unique((gbpJobs ?? []).map((job) => normaliseContentJoin(job.content_items)?.id));
  const contentIdsToArchive = unique([...failedContentIds, ...gbpContentIds]);

  const { data: activeJobs, error: activeError } = await supabase
    .from("publish_jobs")
    .select("id")
    .eq("account_id", account.id)
    .in("status", ["queued", "in_progress"])
    .is("resolved_at", null)
    .returns<Array<{ id: string }>>();

  if (activeError) throw activeError;

  const { data: notifications, error: notificationError } = await supabase
    .from("notifications")
    .select("id, category, metadata, created_at, dismissed_at")
    .eq("account_id", account.id)
    .in("category", [...FAILURE_NOTIFICATION_CATEGORIES])
    .returns<NotificationForCleanup[]>();

  if (notificationError) throw notificationError;

  const activeJobIds = (activeJobs ?? []).map((job) => job.id);
  const notificationIdsToDismiss = collectNotificationIdsToDismiss({
    notifications: notifications ?? [],
    archivedContentIds: new Set(contentIdsToArchive),
    activeJobIds: new Set(activeJobIds),
    now,
    staleBefore,
  });

  return {
    account,
    failedJobs: failedJobs ?? [],
    gbpJobs: gbpJobs ?? [],
    failedContentIds,
    gbpContentIds,
    contentIdsToArchive,
    activeJobIds,
    notificationIdsToDismiss,
  };
}

async function updateByIds(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
  payload: Record<string, unknown>,
): Promise<void> {
  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from(table).update(payload).in("id", chunk);
    if (error) throw error;
  }
}

async function executeCleanup(supabase: SupabaseClient, plan: CleanupPlan): Promise<void> {
  const nowIso = new Date().toISOString();

  await updateByIds(supabase, "content_items", plan.contentIdsToArchive, {
    deleted_at: nowIso,
    updated_at: nowIso,
  });

  await updateByIds(supabase, "publish_jobs", plan.failedJobs.map((job) => job.id), {
    resolved_at: nowIso,
    resolution_kind: "stale_failure_archived",
    resolution_note: "Archived by planner failure cleanup.",
    next_attempt_at: null,
    updated_at: nowIso,
  });

  await updateByIds(supabase, "publish_jobs", plan.gbpJobs.map((job) => job.id), {
    status: "failed",
    last_error: "Legacy GBP publishing is unsupported and has been removed from the planner.",
    error_message: "Legacy GBP publishing is unsupported and has been removed from the planner.",
    next_attempt_at: null,
    resolved_at: nowIso,
    resolution_kind: "legacy_gbp_removed",
    resolution_note: "Removed by planner failure cleanup because GBP publishing is unsupported.",
    updated_at: nowIso,
  });

  await updateByIds(supabase, "notifications", plan.notificationIdsToDismiss, {
    read_at: nowIso,
    dismissed_at: nowIso,
  });
}

function printPlan(plan: CleanupPlan, execute: boolean) {
  console.log(`Planner failure cleanup for ${accountLabel(plan.account)} (${plan.account.id})`);
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Failed jobs to resolve: ${plan.failedJobs.length}`);
  console.log(`Failed content items to archive: ${plan.failedContentIds.length}`);
  console.log(`Legacy GBP jobs to resolve: ${plan.gbpJobs.length}`);
  console.log(`Legacy GBP content items to archive: ${plan.gbpContentIds.length}`);
  console.log(`Notifications to dismiss: ${plan.notificationIdsToDismiss.length}`);

  if (plan.contentIdsToArchive.length) {
    console.log(`Content IDs: ${plan.contentIdsToArchive.join(", ")}`);
  }
  if (plan.gbpJobs.length) {
    console.log(`GBP job IDs: ${plan.gbpJobs.map((job) => job.id).join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const plan = await loadCleanupPlan(supabase, args);

  printPlan(plan, args.execute);

  if (!args.execute) {
    console.log("No changes made. Re-run with --execute to apply.");
    return;
  }

  await executeCleanup(supabase, plan);
  console.log("Cleanup complete.");
}

function formatCliError(error: unknown): unknown {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const typed = error as { code?: string; message?: string };
    if (typed.code === "42703" && typed.message?.includes("publish_jobs.resolved_at")) {
      return "publish_jobs resolution columns are missing. Apply supabase/migrations/20260705120000_publish_job_resolution.sql before running cleanup.";
    }
  }
  return error instanceof Error ? error.message : error;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatCliError(error));
    process.exit(1);
  });
}
