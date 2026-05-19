/**
 * Nightly token health cron endpoint (PLAT-10, NOTIF-03).
 * Called by QStash on a nightly schedule.
 * Checks all social_connections, derives health, updates expired statuses,
 * and sends urgent email for expired/disconnected tokens.
 */

import { NextResponse } from 'next/server';

import { env } from '@/env';
import { deriveConnectionHealth } from '@/lib/connections/health';
import { sendEmail } from '@/lib/email/resend';
import { insertNotification } from '@/lib/notifications/insert';
import { isEmailEnabledForCategory, shouldSendEmail } from '@/lib/notifications/routing';
import { tryCreateServiceSupabaseClient } from '@/lib/supabase/service';
import type { ProviderPlatform } from '@/types/providers';

export const dynamic = 'force-dynamic';

type ConnectionRow = {
  id: string;
  account_id: string;
  platform: string;
  status: string;
  token_expires_at: string | null;
  platform_account_name: string | null;
};

type AccountRow = {
  auth_user_id: string;
};

type PostingDefaultsRow = {
  notifications: Record<string, unknown> | null;
};

/**
 * Map provider identifiers to human-readable labels.
 */
function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    facebook: 'Facebook Page',
    instagram: 'Instagram Business',
    gbp: 'Google Business Profile',
  };
  return labels[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Normalise auth header by stripping "Bearer " prefix.
 */
function normaliseAuthHeader(value: string | null): string {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Core logic: check all connections, update expired statuses,
 * and send urgent email for expired/disconnected tokens (NOTIF-03).
 */
async function checkTokenHealth(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return {
      status: 500,
      body: { error: 'Supabase service role is not configured' },
    };
  }

  // Fetch all non-revoked connections across all accounts
  const { data: connections, error: queryError } = await service
    .from('social_connections')
    .select('id, account_id, platform, status, token_expires_at, platform_account_name')
    .neq('status', 'revoked')
    .returns<ConnectionRow[]>();

  if (queryError) {
    return {
      status: 500,
      body: { error: 'Failed to query social_connections', message: queryError.message },
    };
  }

  if (!connections || connections.length === 0) {
    return {
      status: 200,
      body: { checked: 0, healthy: 0, warning: 0, expired: 0, emailsSent: 0 },
    };
  }

  let healthy = 0;
  let warning = 0;
  let expired = 0;
  let emailsSent = 0;

  for (const conn of connections) {
    const health = deriveConnectionHealth(
      conn.status,
      conn.token_expires_at,
      conn.platform as ProviderPlatform,
    );

    switch (health) {
      case 'green':
        healthy++;
        break;

      case 'amber':
        warning++;
        console.warn(
          `[token-health] Warning: ${conn.platform} connection ${conn.id} ` +
          `(${conn.platform_account_name ?? 'unknown'}) token expiring soon`,
        );
        break;

      case 'red': {
        expired++;
        // Update status to 'expired' if not already marked
        if (conn.status !== 'expired' && conn.status !== 'disconnected') {
          const { error: updateError } = await service
            .from('social_connections')
            .update({ status: 'expired' })
            .eq('id', conn.id);

          if (updateError) {
            console.error(
              `[token-health] Failed to update connection ${conn.id} to expired:`,
              updateError.message,
            );
          } else {
            console.warn(
              `[token-health] Marked ${conn.platform} connection ${conn.id} as expired`,
            );
          }
        }

        // ── Send urgent email for expired/disconnected tokens (NOTIF-03) ──
        const category = conn.status === 'disconnected'
          ? 'connection_disconnected'
          : 'connection_expired';

        const label = providerLabel(conn.platform);
        const statusLabel = conn.status === 'disconnected' ? 'disconnected' : 'token expired';

        // Insert in-app notification
        const { inserted } = await insertNotification({
          supabase: service,
          accountId: conn.account_id,
          category,
          title: `${label} ${statusLabel}`,
          body: `Your ${label} connection (${conn.platform_account_name ?? 'unknown'}) has ${statusLabel}. Reconnect to resume publishing.`,
          resourceType: 'connection',
          resourceId: conn.id,
        });

        // Only send email if notification was new (not a duplicate)
        if (inserted && shouldSendEmail(category)) {
          try {
            // Check account notification preferences
            const { data: postingDefaults } = await service
              .from('posting_defaults')
              .select('notifications')
              .eq('account_id', conn.account_id)
              .maybeSingle<PostingDefaultsRow>();

            if (isEmailEnabledForCategory(category, postingDefaults?.notifications)) {
              // Fetch account owner's email via auth_user_id
              const { data: account } = await service
                .from('accounts')
                .select('auth_user_id')
                .eq('id', conn.account_id)
                .single<AccountRow>();

              if (account?.auth_user_id) {
                const { data: { user } } = await service.auth.admin.getUserById(account.auth_user_id);

                if (user?.email) {
                  const connectionsUrl = `${env.client.NEXT_PUBLIC_SITE_URL}/connections`;

                  const html = `
<p>Hi,</p>
<p><strong>Action required:</strong> Your <strong>${label}</strong> connection (${conn.platform_account_name ?? 'unknown'}) has <strong>${statusLabel}</strong>.</p>
<p>Scheduled posts to ${label} will fail until you reconnect.</p>
<p>
  <a href="${connectionsUrl}">Reconnect your ${label} account now</a>
</p>
<p>— CheersAI</p>
`.trim();

                  await sendEmail({
                    to: user.email,
                    subject: `[CheersAI] Action required: ${label} ${statusLabel}`,
                    html,
                  });

                  emailsSent++;
                }
              }
            }
          } catch (emailErr) {
            console.error(
              `[token-health] Failed to send email for connection ${conn.id}:`,
              emailErr instanceof Error ? emailErr.message : String(emailErr),
            );
          }
        }
        break;
      }
    }
  }

  const summary = {
    checked: connections.length,
    healthy,
    warning,
    expired,
    emailsSent,
  };

  console.log('[token-health] Nightly check complete:', JSON.stringify(summary));

  return { status: 200, body: summary };
}

/**
 * Handle incoming request with CRON_SECRET validation.
 * Follows the same pattern as notify-expiring-connections cron.
 */
async function handle(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const xCronSecret = request.headers.get('x-cron-secret')?.trim();
  const authHeader = normaliseAuthHeader(request.headers.get('authorization'));
  const headerSecret = xCronSecret || authHeader;
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim();

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await checkTokenHealth();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
