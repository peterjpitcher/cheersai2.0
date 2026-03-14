import { NextResponse } from "next/server";

import { env } from "@/env";
import { sendEmail } from "@/lib/email/resend";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Idempotency category stored in the notifications table to track sent emails
const NOTIFICATION_CATEGORY = "publish_failed_email_sent";

// Only look at failures from the last 2 hours to avoid re-processing old jobs
const FAILURE_WINDOW_HOURS = 2;

function normaliseAuthHeader(value: string | null): string {
  if (!value) return "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

// DB row shapes returned by the queries below
type FailedJobRow = {
  id: string;
  last_error: string | null;
  content_item_id: string;
};

type ContentItemRow = {
  account_id: string;
  platform: string;
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
    .select("id, last_error, content_item_id")
    .eq("status", "failed")
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
      body: { processed: 0, emailed: 0, skipped: 0 },
    };
  }

  let emailed = 0;
  let skipped = 0;

  for (const job of failedJobs) {
    try {
      // ── Idempotency check ────────────────────────────────────────────────
      // Skip if we already sent an email for this job
      const { data: existing } = await service
        .from("notifications")
        .select("id")
        .eq("category", NOTIFICATION_CATEGORY)
        // metadata is JSONB — filter by the job_id key
        .filter("metadata->>job_id", "eq", job.id)
        .maybeSingle<NotificationRow>();

      if (existing) {
        skipped++;
        continue;
      }

      // ── Resolve content item → account ───────────────────────────────────
      const { data: contentItem, error: ciError } = await service
        .from("content_items")
        .select("account_id, platform")
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

      const html = `
<p>${greeting}</p>
<p>We were unable to publish one of your posts to <strong>${platformLabel}</strong>.</p>
${
  job.last_error
    ? `<p><strong>Error details:</strong><br>${escapeHtml(job.last_error)}</p>`
    : ""
}
<p>
  Please visit your <a href="${plannerUrl}">Planner</a> to review and reschedule the post.
</p>
<p>If you believe this is an error or need help, please contact support.</p>
<p>— CheersAI</p>
`.trim();

      await sendEmail({
        to: account.email,
        subject: "Post failed to publish — action needed",
        html,
      });

      // ── Record the notification for idempotency ───────────────────────────
      const { error: insertError } = await service.from("notifications").insert({
        account_id: contentItem.account_id,
        category: NOTIFICATION_CATEGORY,
        message: "Failure email sent",
        metadata: { job_id: job.id },
      });

      if (insertError) {
        // Log but don't abort — email was already sent, this is just housekeeping
        console.error(`[notify-failures] Failed to insert notification record for job ${job.id}:`, insertError.message);
      }

      emailed++;
    } catch (err) {
      // Isolate per-job errors so one failure doesn't abort the rest
      console.error(`[notify-failures] Unexpected error processing job ${job.id}:`, err instanceof Error ? err.message : String(err));
      skipped++;
    }
  }

  return {
    status: 200,
    body: {
      processed: failedJobs.length,
      emailed,
      skipped,
    },
  };
}

/**
 * Minimal HTML escaping to prevent XSS if last_error contains user-influenced text.
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
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const xCronSecret = request.headers.get("x-cron-secret")?.trim();
  const authHeader = normaliseAuthHeader(request.headers.get("authorization"));
  const headerSecret = xCronSecret || authHeader;
  const urlSecret = new URL(request.url).searchParams.get("secret")?.trim();

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await notifyFailures();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
