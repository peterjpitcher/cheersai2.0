import { NextResponse } from "next/server";

import { env } from "@/env";
import { sendEmail } from "@/lib/email/resend";
import { insertNotification } from "@/lib/notifications/insert";
import { alertRepeatedPublishFailures } from "@/lib/notifications/operator-alerts";
import { publishFailureText } from "@/lib/publishing/failure-messages";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { verifyCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";

// Idempotency categories stored in the notifications table (with metadata.job_id)
// to track sent emails: this cron's own, and the immediate email sent by
// /api/webhooks/qstash-publish/failure. Either one means the owner has been told.
const NOTIFICATION_CATEGORY = "publish_failed_email_sent";
const IMMEDIATE_NOTIFICATION_CATEGORY = "publish_failed_immediate";

// Only look at failures from the last 2 hours to avoid re-processing old jobs
const FAILURE_WINDOW_HOURS = 2;

// DB row shapes returned by the queries below
type FailedJobRow = {
  id: string;
  /** What the publish-queue edge function writes: Meta's own text, never shown to the owner. */
  last_error: string | null;
  /** What the Next.js publish path and the worker's refusals write. */
  error_message: string | null;
  error_code: string | null;
  content_item_id: string;
  /** When the job last changed, which for a failed job is when it failed. */
  updated_at: string;
};

type ContentItemRow = {
  account_id: string;
  platform: string;
  placement: string | null;
};

type AccountRow = {
  email: string;
  display_name: string | null;
};

type PostingDefaultsRow = {
  notifications: Record<string, unknown> | null;
};

type NotificationRow = {
  id: string;
};

async function notifyFailures(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return {
      status: 500,
      body: { error: "Supabase service role is not configured" },
    };
  }

  // Compute the cutoff timestamp (now − 2 hours) as an ISO string
  const cutoff = new Date(
    Date.now() - FAILURE_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();

  // Fetch recently-failed publish jobs
  const { data: failedJobs, error: jobsError } = await service
    .from("publish_jobs")
    .select("id, last_error, error_message, error_code, content_item_id, updated_at")
    .eq("status", "failed")
    // An archived or auto-resolved failure needs no email; archiving also
    // bumps updated_at, which would otherwise look like a new failure.
    .is("resolved_at", null)
    .gt("updated_at", cutoff)
    .returns<FailedJobRow[]>();

  if (jobsError) {
    return {
      status: 500,
      body: { error: "Failed to query publish_jobs", message: jobsError.message },
    };
  }

  if (!failedJobs || failedJobs.length === 0) {
    return {
      status: 200,
      body: { processed: 0, emailed: 0, skipped: 0, errors: 0 },
    };
  }

  let emailed = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of failedJobs) {
    try {
      // ── Idempotency check ────────────────────────────────────────────────
      // Skip if we already emailed about THIS failure. A job keeps its id
      // when it is re-armed (approving a draft, rescheduling, Publish now), so
      // an email about an earlier failure must not hide a later one: only an
      // email sent at or after the job's latest failure counts.
      const { data: existing } = await service
        .from("notifications")
        .select("id")
        .in("category", [NOTIFICATION_CATEGORY, IMMEDIATE_NOTIFICATION_CATEGORY])
        // metadata is JSONB: filter by the job_id key
        .filter("metadata->>job_id", "eq", job.id)
        .gte("created_at", job.updated_at)
        .limit(1)
        .maybeSingle<NotificationRow>();

      if (existing) {
        skipped++;
        continue;
      }

      // ── Resolve content item → account ───────────────────────────────────
      const { data: contentItem, error: ciError } = await service
        .from("content_items")
        .select("account_id, platform, placement")
        .eq("id", job.content_item_id)
        .single<ContentItemRow>();

      if (ciError || !contentItem) {
        console.warn(`[notify-failures] Could not find content item ${job.content_item_id}:`, ciError?.message);
        skipped++;
        continue;
      }

      // ── Check account notification preferences ────────────────────────────
      const { data: postingDefaults, error: pdError } = await service
        .from("posting_defaults")
        .select("notifications")
        .eq("account_id", contentItem.account_id)
        .maybeSingle<PostingDefaultsRow>();

      if (pdError) {
        console.warn(`[notify-failures] Could not read posting_defaults for account ${contentItem.account_id}:`, pdError.message);
        skipped++;
        continue;
      }

      // Default to true if no row exists (matches createDefaultPosting behaviour in data.ts)
      const emailFailures = postingDefaults?.notifications?.emailFailures !== false;

      if (!emailFailures) {
        skipped++;
        continue;
      }

      // ── Fetch account email ───────────────────────────────────────────────
      const { data: account, error: accountError } = await service
        .from("accounts")
        .select("email, display_name")
        .eq("id", contentItem.account_id)
        .single<AccountRow>();

      if (accountError || !account?.email) {
        console.warn(`[notify-failures] Could not find email for account ${contentItem.account_id}:`, accountError?.message);
        skipped++;
        continue;
      }

      // ── Build and send the email ──────────────────────────────────────────
      const platformLabel = contentItem.platform.charAt(0).toUpperCase() + contentItem.platform.slice(1);
      const plannerUrl = `${env.client.NEXT_PUBLIC_SITE_URL}/planner`;
      const greeting = account.display_name ? `Hi ${account.display_name},` : "Hi,";
      // Plain words for the owner. Meta's own text stays on the publish_jobs
      // row for support (tasks/SPEC-plain-publish-failures.md).
      const failureText = publishFailureText({
        error: job.last_error ?? job.error_message,
        platform: contentItem.platform,
        placement: contentItem.placement,
        errorCode: job.error_code,
      });

      const html = `
<p>${escapeHtml(greeting)}</p>
<p>We were unable to publish one of your posts to <strong>${escapeHtml(platformLabel)}</strong>.</p>
${failureText ? `<p>${escapeHtml(failureText)}</p>` : ""}
<p>
  Please visit your <a href="${plannerUrl}">Planner</a> to review and reschedule the post.
</p>
<p>If you believe this is an error or need help, please contact support.</p>
<p>Cheers by Orange Jelly</p>
`.trim();

      await sendEmail({
        to: account.email,
        subject: "Post failed to publish: action needed",
        html,
      });

      // Record the send so later runs of this cron skip the job. Without this
      // the lookup above never matched and each failure was emailed on every
      // run inside the window.
      const { error: sentRecordError } = await service.from("notifications").insert({
        account_id: contentItem.account_id,
        category: NOTIFICATION_CATEGORY,
        message: "Failure email sent",
        metadata: { job_id: job.id },
      });
      if (sentRecordError) {
        // Without the record the next run emails the owner again.
        errors++;
        console.error(`[notify-failures] Failed to record sent email for job ${job.id}:`, sentRecordError.message);
      }

      // ── Record the notification via shared helper ────────────────────────
      const notification = await insertNotification({
        supabase: service,
        accountId: contentItem.account_id,
        category: "publish_failed",
        title: `${platformLabel} post failed to publish`,
        body: failureText ?? "Publishing failed. Please check the Planner for details.",
        resourceType: "content_item",
        resourceId: job.content_item_id,
      });

      if (notification.status === "failed") {
        // The email has gone, but the in-app alert is missing: report it.
        errors++;
        console.error(`[notify-failures] Failed to insert notification record for job ${job.id}:`, notification.error);
      }

      emailed++;
    } catch (err) {
      // Isolate per-job errors so one failure doesn't abort the rest
      console.error(`[notify-failures] Unexpected error processing job ${job.id}:`, err instanceof Error ? err.message : String(err));
      errors++;
    }
  }

  // Any error fails the run so it shows up in Vercel instead of passing quietly.
  return {
    status: errors > 0 ? 500 : 200,
    body: {
      processed: failedJobs.length,
      emailed,
      skipped,
      errors,
    },
  };
}

/**
 * Minimal HTML escaping to prevent XSS if error fields contain user-influenced text.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  const result = await notifyFailures();

  // Operator alert runs on every pass, independent of the customer emails
  // above (a customer may have failure emails turned off). A failure here marks
  // the cron run as failed so it shows up in Vercel.
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return NextResponse.json({ ...result.body, operatorAlert: { error: "service role not configured" } }, { status: 500 });
  }
  try {
    const operatorAlert = await alertRepeatedPublishFailures(service);
    return NextResponse.json({ ...result.body, operatorAlert }, { status: result.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-failures] Operator alert failed:", message);
    return NextResponse.json({ ...result.body, operatorAlert: { error: message } }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
