import { NextResponse } from "next/server";

import { env } from "@/env";
import { sendEmail } from "@/lib/email/resend";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Idempotency category stored in the notifications table to track sent emails
const NOTIFICATION_CATEGORY = "expiring_connection_email_sent";

// Warn when a connection expires within this many days
const EXPIRY_WARNING_DAYS = 7;

function normaliseAuthHeader(value: string | null): string {
  if (!value) return "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

// DB row shapes returned by the queries below
type ExpiringConnectionRow = {
  id: string;
  account_id: string;
  provider: string;
  expires_at: string;
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

/**
 * Map provider identifiers to human-readable labels.
 */
function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    facebook: "Facebook Page",
    instagram: "Instagram Business",
    gbp: "Google Business Profile",
  };
  return labels[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Compute the number of whole days until a connection expires.
 */
function daysUntilExpiry(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

async function notifyExpiringConnections(): Promise<{
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

  // Compute the expiry window: connections that expire between now and now + EXPIRY_WARNING_DAYS
  const now = new Date();
  const windowEnd = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // Fetch connections expiring within the warning window (not already expired, not inactive)
  const { data: expiringConnections, error: connectionsError } = await service
    .from("social_connections")
    .select("id, account_id, provider, expires_at")
    .neq("status", "inactive")
    .not("expires_at", "is", null)
    .lt("expires_at", windowEnd)
    .gt("expires_at", nowIso)
    .returns<ExpiringConnectionRow[]>();

  if (connectionsError) {
    return {
      status: 500,
      body: { error: "Failed to query social_connections", message: connectionsError.message },
    };
  }

  if (!expiringConnections || expiringConnections.length === 0) {
    return {
      status: 200,
      body: { processed: 0, emailed: 0, skipped: 0 },
    };
  }

  let emailed = 0;
  let skipped = 0;

  for (const connection of expiringConnections) {
    try {
      // ── Idempotency check ────────────────────────────────────────────────
      // Skip if we already sent a warning email for this connection within the last 7 days
      const idempotencyWindow = new Date(
        Date.now() - EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: existing } = await service
        .from("notifications")
        .select("id")
        .eq("category", NOTIFICATION_CATEGORY)
        .filter("metadata->>connection_id", "eq", connection.id)
        .gt("created_at", idempotencyWindow)
        .maybeSingle<NotificationRow>();

      if (existing) {
        skipped++;
        continue;
      }

      // ── Check account notification preferences ────────────────────────────
      const { data: postingDefaults, error: pdError } = await service
        .from("posting_defaults")
        .select("notifications")
        .eq("account_id", connection.account_id)
        .maybeSingle<PostingDefaultsRow>();

      if (pdError) {
        console.warn(
          `[notify-expiring-connections] Could not read posting_defaults for account ${connection.account_id}:`,
          pdError.message,
        );
        skipped++;
        continue;
      }

      // Default to true if no row exists (matches createDefaultPosting behaviour in data.ts)
      const emailTokenExpiring = postingDefaults?.notifications?.emailTokenExpiring !== false;

      if (!emailTokenExpiring) {
        skipped++;
        continue;
      }

      // ── Fetch account email ───────────────────────────────────────────────
      const { data: account, error: accountError } = await service
        .from("accounts")
        .select("email, display_name")
        .eq("id", connection.account_id)
        .single<AccountRow>();

      if (accountError || !account?.email) {
        console.warn(
          `[notify-expiring-connections] Could not find email for account ${connection.account_id}:`,
          accountError?.message,
        );
        skipped++;
        continue;
      }

      // ── Build and send the email ──────────────────────────────────────────
      const days = daysUntilExpiry(connection.expires_at);
      const label = providerLabel(connection.provider);
      const connectionsUrl = `${env.client.NEXT_PUBLIC_SITE_URL}/connections`;
      const greeting = account.display_name ? `Hi ${account.display_name},` : "Hi,";
      const dayWord = days === 1 ? "day" : "days";

      const html = `
<p>${greeting}</p>
<p>Your <strong>${label}</strong> connection is expiring in <strong>${days} ${dayWord}</strong>. Please reconnect to avoid publishing failures.</p>
<p>
  <a href="${connectionsUrl}">Manage your connections</a>
</p>
<p>— CheersAI</p>
`.trim();

      await sendEmail({
        to: account.email,
        subject: `Action needed: your ${label} connection expires in ${days} ${dayWord}`,
        html,
      });

      // ── Record the notification for idempotency ───────────────────────────
      const { error: insertError } = await service.from("notifications").insert({
        account_id: connection.account_id,
        category: NOTIFICATION_CATEGORY,
        message: `Expiring connection warning email sent for ${label}`,
        metadata: { connection_id: connection.id },
      });

      if (insertError) {
        // Log but don't abort — email was already sent, this is just housekeeping
        console.error(
          `[notify-expiring-connections] Failed to insert notification record for connection ${connection.id}:`,
          insertError.message,
        );
      }

      emailed++;
    } catch (err) {
      // Isolate per-connection errors so one failure doesn't abort the rest
      console.error(
        `[notify-expiring-connections] Unexpected error processing connection ${connection.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      skipped++;
    }
  }

  return {
    status: 200,
    body: {
      processed: expiringConnections.length,
      emailed,
      skipped,
    },
  };
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

  const result = await notifyExpiringConnections();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
