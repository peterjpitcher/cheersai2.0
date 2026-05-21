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
import { verifyCronAuth } from '@/lib/security/cron-auth';
import type { ProviderPlatform } from '@/types/providers';

export const dynamic = 'force-dynamic';

type ConnectionRow = {
  id: string;
  account_id: string;
  provider: string;
  status: string;
  token_expires_at: string | null;
  expires_at: string | null;
  platform_account_name: string | null;
  display_name: string | null;
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
    .select('id, account_id, provider, status, token_expires_at, expires_at, platform_account_name, display_name')
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
    const provider = conn.provider as ProviderPlatform;
    const displayName = conn.platform_account_name ?? conn.display_name ?? 'unknown';
    const effectiveExpiry = conn.token_expires_at ?? conn.expires_at;
    const health = deriveConnectionHealth(
      conn.status,
      effectiveExpiry,
      provider,
    );

    switch (health) {
      case 'green':
        healthy++;
        break;

      case 'amber':
        warning++;
        console.warn(
          `[token-health] Warning: ${provider} connection ${conn.id} ` +
          `(${displayName}) token expiring soon`,
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
            const fallback = await service
              .from('social_connections')
              .update({ status: 'needs_action' })
              .eq('id', conn.id);

            if (fallback.error) {
              console.error(
                `[token-health] Failed to update connection ${conn.id} to needs_action:`,
                fallback.error.message,
              );
            }
          } else {
            console.warn(
              `[token-health] Marked ${provider} connection ${conn.id} as expired`,
            );
          }
        }

        // ── Send urgent email for expired/disconnected tokens (NOTIF-03) ──
        const category = conn.status === 'disconnected'
          ? 'connection_disconnected'
          : 'connection_expired';

        const label = providerLabel(provider);
        const statusLabel = conn.status === 'disconnected' ? 'disconnected' : 'token expired';

        // Insert in-app notification
        const { inserted } = await insertNotification({
          supabase: service,
          accountId: conn.account_id,
          category,
          title: `${label} ${statusLabel}`,
          body: `Your ${label} connection (${displayName}) has ${statusLabel}. Reconnect to resume publishing.`,
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
<p><strong>Action required:</strong> Your <strong>${label}</strong> connection (${displayName}) has <strong>${statusLabel}</strong>.</p>
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
 * Handle incoming request with centralised CRON_SECRET validation.
 */
async function handle(request: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json({ error: auth.errorMessage }, { status: auth.errorStatus ?? 401 });
  }

  const result = await checkTokenHealth();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
