import { NextResponse } from "next/server";

import { env } from "@/env";
import { sendEmail } from "@/lib/email/resend";
import { insertNotification } from "@/lib/notifications/insert";
import { isEmailEnabledForCategory } from "@/lib/notifications/routing";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";
import { verifyCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";

// Warn when a connection expires within this many days (in-app notification)
const EXPIRY_WARNING_DAYS = 7;

// Email only when expiry is this close or less (NOTIF-04)
const EMAIL_THRESHOLD_DAYS = 4;

// DB row shapes returned by the queries below
type ExpiringConnectionRow = {
  id: string;
  account_id: string;
  provider: string;
  token_expires_at: string | null;
  expires_at: string | null;
};

type AccountRow = {
  email: string;
  display_name: string | null;
};

type PostingDefaultsRow = {
  notifications: Record<string, unknown> | null;
};

/**
 * Map provider identifiers to human-readable labels.
 */
function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    facebook: "Facebook Page",
    instagram: "Instagram Business",
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

  // Fetch connections expiring within the warning window (not already expired, not inactive).
  // Use token_expires_at (v2) with fallback to legacy expires_at.
  const { data: expiringConnections, error: connectionsError } = await service
    .from("social_connections")
    .select("id, account_id, provider, token_expires_at, expires_at")
    .neq("status", "inactive")
    .or("token_expires_at.not.is.null,expires_at.not.is.null")
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
      body: { processed: 0, notified: 0, emailed: 0, skipped: 0 },
    };
  }

  // Filter in-memory using effective expiry (token_expires_at ?? expires_at)
  const nowMs = now.getTime();
  const windowEndMs = new Date(windowEnd).getTime();
  const connectionsInWindow = expiringConnections.filter((c) => {
    const effective = c.token_expires_at ?? c.expires_at;
    if (!effective) return false;
    const ms = new Date(effective).getTime();
    return ms > nowMs && ms < windowEndMs;
  });

  let notified = 0;
  let emailed = 0;
  let skipped = 0;

  for (const connection of connectionsInWindow) {
    try {
      // Prefer token_expires_at (v2); fall back to legacy expires_at
      const effectiveExpiry = (connection.token_expires_at ?? connection.expires_at)!;
      const days = daysUntilExpiry(effectiveExpiry);
      const label = providerLabel(connection.provider);
      const dayWord = days === 1 ? "day" : "days";

      // ── Insert in-app notification via shared helper (idempotency built in) ──
      const { inserted } = await insertNotification({
        supabase: service,
        accountId: connection.account_id,
        category: "connection_expiring",
        title: `${label} token expires in ${days} ${dayWord}`,
        body: `Your ${label} connection expires in ${days} ${dayWord}. Reconnect to avoid publishing failures.`,
        resourceType: "connection",
        resourceId: connection.id,
      });

      if (!inserted) {
        // Already notified within 24h — skip
        skipped++;
        continue;
      }

      notified++;

      // ── Email only when <= 4 days (NOTIF-04) ─────────────────────────────
      if (days > EMAIL_THRESHOLD_DAYS) {
        continue;
      }

      // Check account notification preferences
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
        continue;
      }

      if (!isEmailEnabledForCategory("connection_expiring", postingDefaults?.notifications)) {
        continue;
      }

      // Fetch account email
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
        continue;
      }

      // Build and send the email
      const connectionsUrl = `${env.client.NEXT_PUBLIC_SITE_URL}/connections`;
      const greeting = account.display_name ? `Hi ${account.display_name},` : "Hi,";

      const html = `
<p>${greeting}</p>
<p>Your <strong>${label}</strong> connection expires in <strong>${days} ${dayWord}</strong>. Please reconnect now to avoid publishing failures.</p>
<p>
  <a href="${connectionsUrl}">Reconnect your ${label} account</a>
</p>
<p>If you don't reconnect before the token expires, scheduled posts to ${label} will fail.</p>
<p>— CheersAI</p>
`.trim();

      await sendEmail({
        to: account.email,
        subject: `[CheersAI] ${label} token expires in ${days} ${dayWord}`,
        html,
      });

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
      processed: connectionsInWindow.length,
      notified,
      emailed,
      skipped,
    },
  };
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
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
