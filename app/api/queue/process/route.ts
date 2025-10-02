import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/datetime";
import { FacebookClient } from "@/lib/social/facebook";
import { InstagramClient } from "@/lib/social/instagram";
import { nextAttemptDate } from "@/lib/utils/backoff";
import { logger, createRequestLogger } from '@/lib/observability/logger'
import { mapProviderError } from '@/lib/errors'
import type { Provider } from '@/lib/errors'
import { captureException } from '@/lib/observability/sentry'
import { getInternalBaseUrl } from '@/lib/utils/get-app-url'
import { decryptToken } from '@/lib/security/encryption'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import { mapToGbpPayload } from '@/lib/gbp/mapper'
import type { Database } from '@/lib/types/database'
import { recomputeCampaignStatusSafe } from '@/lib/campaigns/status'
import { ensureScheduledPostsEnqueued } from '@/lib/queue/reconcile'

const facebookServiceFetch = createServiceFetch('facebook')
const facebookFetch = (url: string, init?: RequestInit) =>
  withRetry(() => facebookServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  })

type PublishingQueueRow = Database['public']['Tables']['publishing_queue']['Row']
type CampaignPostRow = Database['public']['Tables']['campaign_posts']['Row']
type SocialConnectionRow = Database['public']['Tables']['social_connections']['Row']

type ClaimedQueueItem = Pick<PublishingQueueRow, 'id' | 'attempts'>

type CampaignPostForQueue = Pick<CampaignPostRow, 'content' | 'media_assets' | 'media_url' | 'tenant_id' | 'campaign_id'> & {
  campaigns: { id: string | null } | null
}

type SocialConnectionForQueue = Pick<
  SocialConnectionRow,
  'platform' | 'access_token' | 'refresh_token' | 'access_token_encrypted' | 'refresh_token_encrypted' | 'token_expires_at' | 'page_id' | 'account_id' | 'account_name'
>

type QueueItem = PublishingQueueRow & {
  campaign_posts: CampaignPostForQueue | null
  social_connections: SocialConnectionForQueue | null
}

type PublishResult = {
  id: string
  permalink?: string | null
}

type ProcessResult = {
  queueId: string
  success: boolean
  postId?: string
  error?: string
  errorCode?: string
}

type ServiceSupabaseClient = SupabaseClient<Database>


// This endpoint processes the publishing queue
// Should be called by a cron job every minute
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const reqLogger = createRequestLogger(request as unknown as Request)
    const startedAt = Date.now()
    // Verify this is called by our cron service (add your own auth here)
    const authHeader = request.headers.get("authorization");
    const vercelCronHeader = request.headers.get('x-vercel-cron');
    const cronSecret = process.env.CRON_SECRET;
    const authorized = cronSecret
      ? authHeader === `Bearer ${cronSecret}`
      : Boolean(vercelCronHeader);
    if (!authorized) {
      reqLogger.event('warn', { area: 'queue', op: 'cron.auth', status: 'fail', msg: 'Unauthorized cron' })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use service-role for internal cron to bypass RLS safely
    const supabase: ServiceSupabaseClient = await createServiceRoleClient();
    const now = new Date();

    // Ensure scheduled posts have queue entries before claiming work
    try {
      await ensureScheduledPostsEnqueued(supabase)
    } catch (error) {
      logger.error('queue.reconcile: unexpected failure', {
        area: 'queue',
        op: 'reconcile.run',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }

    // Safety: recover items stuck in 'processing' due to prior crashes/timeouts
    try {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await supabase
        .from('publishing_queue')
        .update({ status: 'pending', next_attempt_at: null })
        .eq('status', 'processing')
        .lte('last_attempt_at', cutoff);
    } catch {}

    // Try atomic claim via RPC; fall back to ad-hoc selection if RPC not available
    let claimed: ClaimedQueueItem[] = []
    try {
      const { data: rpcRows, error: rpcErr } = await supabase.rpc('claim_due_queue', {
        batch_size: 10,
      })
      if (rpcErr) throw rpcErr
      if (Array.isArray(rpcRows)) {
        claimed = rpcRows.reduce<ClaimedQueueItem[]>((acc, raw) => {
          if (raw && typeof raw.id === 'string') {
            acc.push({ id: raw.id, attempts: (raw as { attempts?: number | null }).attempts ?? 0 })
          }
          return acc
        }, [])
      }
    } catch (error) {
      logger.warn('claim_due_queue RPC unavailable, falling back to manual claim', {
        area: 'queue',
        op: 'cron.claim',
        status: 'warn',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      // Fallback: select then mark processing (best-effort, non-atomic)
      const { data: queueItemsForClaim, error: claimError } = await supabase
        .from('publishing_queue')
        .select('id, attempts')
        .eq('status', 'pending')
        .or(`scheduled_for.lte.${now.toISOString()},next_attempt_at.lte.${now.toISOString()}`)
        .lt('attempts', 5)
        .order('scheduled_for', { ascending: true })
        .limit(10)
      if (claimError) {
        logger.error('Error fetching queue items', { area: 'queue', op: 'fetch', error: claimError })
        captureException(claimError, { tags: { area: 'queue', op: 'fetch' } })
        return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 })
      }
      for (const item of queueItemsForClaim ?? []) {
        const nextAttempts = (item.attempts ?? 0) + 1
        const { error: updateError } = await supabase
          .from('publishing_queue')
          .update({ status: 'processing', last_attempt_at: now.toISOString(), attempts: nextAttempts })
          .eq('id', item.id)
          .eq('status', 'pending')
        if (!updateError) {
          claimed.push({ id: item.id, attempts: nextAttempts })
        }
      }
    }

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ message: 'No items to process' })
    }

    const internalBaseUrl = getInternalBaseUrl(request)
    const notificationSecret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET

    const sendNotification = async (payload: Record<string, unknown>) => {
      if (!notificationSecret) {
        reqLogger.event('warn', {
          area: 'notifications',
          op: 'email.send',
          status: 'fail',
          msg: 'Skipped email notification; INTERNAL_API_SECRET/CRON_SECRET not configured',
        })
        return
      }
      try {
        const response = await fetch(`${internalBaseUrl}/api/notifications/email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${notificationSecret}`,
          },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          reqLogger.event('warn', {
            area: 'notifications',
            op: 'email.send',
            status: 'fail',
            msg: 'Notification endpoint returned non-success status',
            meta: { status: response.status },
          })
        }
      } catch (error) {
        reqLogger.event('error', {
          area: 'notifications',
          op: 'email.send',
          status: 'fail',
          msg: 'Failed to dispatch email notification',
          meta: { error: error instanceof Error ? error.message : String(error) },
        })
      }
    }

    // Load enriched rows with joins needed for publishing
    const { data: queueItems } = await supabase
      .from('publishing_queue')
      .select(`
        *,
        campaign_posts (
          content,
          media_assets,
          media_url,
          tenant_id,
          campaign_id,
          campaigns(id)
        ),
        social_connections (
          platform,
          access_token,
          refresh_token,
          access_token_encrypted,
          refresh_token_encrypted,
          token_expires_at,
          page_id,
          account_id,
          account_name
        )
      `)
      .in('id', claimed.map(c => c.id))
      .returns<QueueItem[]>()

    const queueItemsList = queueItems ?? []

    const results: ProcessResult[] = []
    const touchedCampaignIds = new Set<string>()

    // Simple concurrency limiter (max 3 concurrent publishes)
    const maxConcurrent = 3
    let idx = 0
    async function worker() {
      while (true) {
        const currentIndex = idx++
        if (currentIndex >= queueItemsList.length) break
        const item = queueItemsList[currentIndex]
        const post = item.campaign_posts
        const connection = item.social_connections
        if (!post || !connection) {
          logger.warn('Queue item missing required relations', {
            area: 'queue',
            op: 'publish',
            queueId: item.id,
            hasPost: Boolean(post),
            hasConnection: Boolean(connection),
          })
          results.push({ queueId: item.id, success: false, error: 'Missing queue relations' })
          continue
        }

        if (!post.tenant_id) {
          logger.warn('Queue item missing tenant context', {
            area: 'queue',
            op: 'publish',
            queueId: item.id,
          })
          results.push({ queueId: item.id, success: false, error: 'Missing tenant context' })
          continue
        }
        const tenantIdForPost = post.tenant_id
        let provider: Provider = 'generic'

      try {
        // Get media URLs if needed (prefer media_assets; fallback to single media_url)
        let mediaUrls: string[] = [];
        if (post.media_assets?.length) {
          const { data: mediaAssets } = await supabase
            .from("media_assets")
            .select("file_url")
            .in("id", post.media_assets);
          mediaUrls = mediaAssets?.map(m => m.file_url) || [];
        }
        if (mediaUrls.length === 0 && post.media_url) {
          mediaUrls = [post.media_url];
        }

        let publishResult: PublishResult | null = null;

        // Decrypt access token if encrypted
        const accessToken = connection.access_token_encrypted
          ? decryptToken(connection.access_token_encrypted)
          : connection.access_token;
        const refreshToken = connection.refresh_token_encrypted
          ? decryptToken(connection.refresh_token_encrypted)
          : connection.refresh_token;
        if (!accessToken) {
          throw new Error('Missing access token for social connection')
        }

        // Use the venue's original link as written; no short links or UTMs for scheduled posts
        const textToPost = post.content ?? ''
        provider = mapPlatformToProvider(connection.platform)
        const platformKey = String(connection.platform || '').toLowerCase().trim()
        switch (platformKey) {
          case "facebook":
            if (!connection.page_id) {
              throw new Error('Facebook connection missing page identifier')
            }
            const fbClient = new FacebookClient(accessToken);
            publishResult = await fbClient.publishToPage(
              connection.page_id,
              textToPost,
              mediaUrls[0] ?? undefined // Facebook takes one image at a time
            );
            break;

          case "instagram":
          case "instagram_business":
            const igClient = new InstagramClient(accessToken);
            // Ensure we have the Instagram Business Account ID
            let igAccountId = connection.account_id as string | null
            if (!igAccountId && connection.page_id) {
              try {
              const resp = await facebookFetch(`https://graph.facebook.com/v23.0/${connection.page_id}?fields=instagram_business_account&access_token=${accessToken}`)
                if (resp.ok) {
                  const json = await resp.json()
                  igAccountId = json?.instagram_business_account?.id || null
                }
              } catch {}
            }
            if (!igAccountId) {
              throw new Error('No Instagram Business Account connected to this Facebook Page')
            }
            igClient.setInstagramAccount(igAccountId);
            
            if (mediaUrls.length === 0) {
              throw new Error("Instagram requires at least one image");
            }
            
            if (mediaUrls.length > 1) {
              // Create carousel post
              publishResult = await igClient.publishToInstagram({
                caption: textToPost,
                media_type: "CAROUSEL",
                children: mediaUrls.map(url => ({
                  media_url: url,
                  media_type: "IMAGE"
                }))
              });
            } else {
              // Single image post
              publishResult = await igClient.publishToInstagram({
                caption: textToPost,
                image_url: mediaUrls[0]
              });
            }
            break;
          case "google_my_business":
            {
              const { GoogleMyBusinessClient } = await import('@/lib/social/google-my-business/client');
              const client = new GoogleMyBusinessClient({
                clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
                clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
                redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-my-business/callback`,
                accessToken: accessToken || undefined,
                refreshToken: refreshToken || undefined,
                tenantId: tenantIdForPost,
                connectionId: String(item.social_connection_id),
              })
              const accountId = normalizeAccountId(connection.account_id)
              const locationId = normalizeLocationId(connection.page_id)
              if (!accountId || !locationId) {
                throw new Error('Google Business Profile connection missing account or location')
              }
              const mapped = mapToGbpPayload({
                type: 'UPDATE',
                text: textToPost,
                imageUrl: mediaUrls[0] || '',
              })
              const res = await client.createPost(accountId, locationId, mapped.payload)
              if (!res.success || !res.postId) {
                throw new Error(res.error || 'Failed to create GMB post')
              }
              publishResult = {
                id: res.postId,
                permalink: res.searchUrl ?? null,
              }
            }
            break;

          default:
            throw new Error(`Unsupported platform: ${connection.platform}`);
        }

        if (!publishResult || !publishResult.id) {
          throw new Error('Publish result missing id')
        }
        const publishedId = publishResult.id
        const publishedPermalink = publishResult.permalink ?? ''

        // Mark as completed
        await supabase
          .from("publishing_queue")
          .update({ 
            status: "completed",
            next_attempt_at: null,
            last_error: null
          })
          .eq("id", item.id);

        // Record in publishing history
        await supabase
          .from("publishing_history")
          .insert({
            campaign_post_id: item.campaign_post_id,
            social_connection_id: item.social_connection_id,
            platform: connection.platform,
            status: "published",
            published_at: now.toISOString(),
            platform_post_id: publishedId,
            external_id: publishedId,
            account_name: connection.account_name,
            connection_id: item.social_connection_id
          });

        // Audit: publish action
        try {
          await supabase.from('audit_log').insert({
            tenant_id: tenantIdForPost,
            user_id: null,
            entity_type: 'campaign_post',
            entity_id: String(item.campaign_post_id),
            action: 'publish',
            meta: { platform: connection.platform, connection_id: item.social_connection_id, platform_post_id: publishedId }
          })
        } catch {}

        // Send success notification
        const campaignId = post.campaigns?.id
        if (campaignId) {
          const { data: campaign } = await supabase
            .from("campaigns")
            .select("name, tenant_id")
            .eq("id", campaignId)
            .single();

          if (campaign?.tenant_id) {
            const tenantForCampaign = campaign.tenant_id
            const { data: users } = await supabase
              .from("users")
              .select("email, id")
              .eq("tenant_id", tenantForCampaign);

            const [firstUser] = users ?? []
            if (firstUser?.email) {
              await sendNotification({
                type: 'postPublished',
                recipientEmail: firstUser.email,
                data: {
                  userId: firstUser.id,
                  tenantId: tenantForCampaign,
                  campaignName: campaign.name,
                  platform: connection.platform,
                  publishedAt: formatDateTime(new Date()),
                  postUrl: publishedPermalink,
                },
              })
            }
          }
        }

        const durationMs = Date.now() - startedAt
        reqLogger.event('info', {
          area: 'queue',
          op: 'publish',
          status: 'ok',
          platform: connection.platform,
          connectionId: String(item.social_connection_id),
          tenantId: tenantIdForPost,
          durationMs,
          msg: 'Queue item published',
          meta: { provider },
        })

        results.push({ queueId: item.id, success: true, postId: publishedId });

        if (item.campaign_post_id) {
          const { error: postUpdateError } = await supabase
            .from('campaign_posts')
            .update({
              status: 'published',
              scheduled_for: item.scheduled_for ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.campaign_post_id)

          if (postUpdateError) {
            reqLogger.warn('Failed to update campaign post after queue publish', {
              area: 'queue',
              op: 'post.publish',
              status: 'fail',
              error: postUpdateError,
              queueId: item.id,
              postId: item.campaign_post_id,
            })
          }
        }

        if (post.campaign_id) {
          touchedCampaignIds.add(post.campaign_id)
        }

      } catch (unknownError) {
        const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError))
        const mapped = mapProviderError(err, provider)
        logger.warn(`Failed to publish queue item ${item.id}`, {
          area: 'queue',
          op: 'publish',
          error: err,
          errorCode: mapped.code,
          platform: connection.platform,
          connectionId: String(item.social_connection_id),
          tenantId: tenantIdForPost,
        })
        captureException(err, { tags: { area: 'queue', op: 'publish', platform: connection.platform || 'unknown' } })

        if (post.campaign_id) {
          touchedCampaignIds.add(post.campaign_id)
        }

        // Categorize the error
        const normalizedMessage = err.message.toLowerCase()
        const retryablePatterns = ['rate limit', 'timeout', 'temporarily', '503', '502', '429']
        const permanentPatterns = ['invalid token', 'unauthorized', 'forbidden', 'not found', '400']

        const isRetryableError = retryablePatterns.some(pattern => normalizedMessage.includes(pattern))
        const isPermanentError = permanentPatterns.some(pattern => normalizedMessage.includes(pattern))

        // Check if we've exceeded max attempts or hit a permanent error
        const attempts = item.attempts ?? 0
        if (attempts >= 4 || isPermanentError) {
          // Mark as failed after 5 attempts or permanent error
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "failed",
              last_error: err.message
            })
            .eq("id", item.id);

          // Record failure in history
          await supabase
            .from("publishing_history")
            .insert({
              campaign_post_id: item.campaign_post_id,
              social_connection_id: item.social_connection_id,
              platform: connection.platform,
              status: "failed",
              error_message: err.message,
              account_name: connection.account_name,
              connection_id: item.social_connection_id
            });

          // Audit: publish_failed
         try {
           await supabase.from('audit_log').insert({
              tenant_id: tenantIdForPost,
              user_id: null,
              entity_type: 'campaign_post',
              entity_id: String(item.campaign_post_id),
              action: 'publish_failed',
              meta: { platform: connection.platform, error: err.message }
            })
          } catch {}

          // Send failure notification
          await sendFailureNotification(supabase, item, mapped.message, internalBaseUrl, notificationSecret, reqLogger);
        } else if (isRetryableError) {
          // Calculate exponential backoff: 2^attempts minutes (capped)
          const attemptsForBackoff = attempts === 0 ? 1 : attempts
          const nextRetryTime = nextAttemptDate(now, attemptsForBackoff, 60);

          // Set to retry with exponential backoff
          await supabase
            .from("publishing_queue")
            .update({ 
              status: "pending",
              last_error: err.message,
              scheduled_for: nextRetryTime.toISOString(),
              next_attempt_at: nextRetryTime.toISOString()
            })
            .eq("id", item.id);
        } else {
          // Unknown error - retry with shorter backoff
          const nextRetryTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

          await supabase
            .from("publishing_queue")
            .update({ 
              status: "pending",
              last_error: err.message,
              scheduled_for: nextRetryTime.toISOString(),
              next_attempt_at: nextRetryTime.toISOString()
            })
            .eq("id", item.id);
        }

        const durationMs = Date.now() - startedAt
        reqLogger.event('warn', {
          area: 'queue',
          op: 'publish',
          status: 'fail',
          platform: connection.platform,
          connectionId: String(item.social_connection_id),
          tenantId: tenantIdForPost,
          durationMs,
          errorCode: mapped.code,
          msg: mapped.message,
        })
        results.push({ queueId: item.id, success: false, error: mapped.message, errorCode: mapped.code });
      }
    }
    }

    const workers = Array.from({ length: Math.min(maxConcurrent, queueItems?.length || 0) }, () => worker())
    await Promise.all(workers)

    if (touchedCampaignIds.size > 0) {
      await Promise.all(
        Array.from(touchedCampaignIds).map(async (campaignId) => {
          await recomputeCampaignStatusSafe(supabase, campaignId)
        }),
      )
    }

    return NextResponse.json({ 
      processed: results.length,
      results 
    });

  } catch (error) {
    logger.error("Queue processing error", { area: 'queue', op: 'cron', error: error instanceof Error ? error : new Error(String(error)) })
    captureException(error, { tags: { area: 'queue', op: 'cron' } })
    return NextResponse.json(
      { error: "Failed to process queue" },
      { status: 500 }
    );
  }
}

function normalizeAccountId(accountId: string | null): string {
  if (!accountId) return ''
  if (accountId.startsWith('accounts/')) return accountId.split('/')[1] || ''
  return accountId
}

function normalizeLocationId(loc: string | null): string {
  if (!loc) return ''
  const parts = String(loc).split('/')
  const idx = parts.lastIndexOf('locations')
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]
  if (String(loc).startsWith('locations/')) return String(loc).split('/')[1] || ''
  return String(loc)
}

function mapPlatformToProvider(platform: string | null | undefined): Provider {
  if (!platform) return 'generic'
  const normalized = platform.toLowerCase()
  if (normalized.includes('instagram')) return 'instagram'
  if (normalized.includes('facebook')) return 'facebook'
  if (normalized.includes('google')) return 'gbp'
  return 'generic'
}

// Helper function to send failure notifications
async function sendFailureNotification(
  supabase: ServiceSupabaseClient,
  item: QueueItem,
  errorMessage: string,
  baseUrl: string,
  notificationSecret: string | undefined,
  reqLogger: ReturnType<typeof createRequestLogger>
) {
  try {
    const post = item.campaign_posts
    const connection = item.social_connections
    if (!post || !connection) {
      reqLogger.event('warn', {
        area: 'queue',
        op: 'failure.notify',
        status: 'fail',
        msg: 'Missing post or connection on queue item when sending failure notification',
        meta: { queueId: item.id },
      })
      return
    }
    // Get campaign details
    const campaignId = post.campaigns?.id
    if (!campaignId) return

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name, tenant_id")
      .eq("id", campaignId)
      .single();

    if (!campaign?.tenant_id) return;
    const tenantForCampaign = campaign.tenant_id

    // Get tenant users to notify
    const { data: users } = await supabase
      .from("users")
      .select("email, id")
      .eq("tenant_id", tenantForCampaign);

    if (!users || users.length === 0) return;
    const [firstUser] = users
    if (!firstUser?.email) return

    // Send email notification
    if (notificationSecret) {
      const response = await fetch(`${baseUrl}/api/notifications/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${notificationSecret}`,
        },
        body: JSON.stringify({
          type: 'postFailed',
          recipientEmail: firstUser.email,
          data: {
            userId: firstUser.id,
            tenantId: tenantForCampaign,
            campaignName: campaign.name,
            platform: connection.platform || 'unknown',
            error: errorMessage,
            failedAt: formatDateTime(new Date()),
            attempts: item.attempts || 1,
          },
        }),
      });
      if (!response.ok) {
        reqLogger.event('warn', {
          area: 'notifications',
          op: 'email.send',
          status: 'fail',
          msg: 'Failure notification request returned non-200',
          meta: { status: response.status },
        })
      }
    } else {
      reqLogger.event('warn', {
        area: 'notifications',
        op: 'email.send',
        status: 'fail',
        msg: 'Skipped failure email notification; INTERNAL_API_SECRET/CRON_SECRET not configured',
      })
    }

    // Also create an in-app notification
    await supabase
      .from("notifications")
      .insert({
        user_id: firstUser.id,
        tenant_id: tenantForCampaign,
        type: "publishing_failed",
        title: "Post Publishing Failed",
        message: `Failed to publish to ${connection.platform || "platform"} after ${item.attempts || 1} attempts: ${errorMessage}`,
        data: {
          campaign_id: post.campaigns?.id,
          queue_item_id: item.id,
          platform: connection.platform,
          error: errorMessage
        },
        read: false,
        created_at: new Date().toISOString()
      });
  } catch (error) {
    logger.error('Error sending failure notification', {
      area: 'queue',
      op: 'failure.notify',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }
}

// GET endpoint to check queue status
export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 400 });
    }

    // Get queue status for this tenant
    const { data: queueItems } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts!inner (
          tenant_id,
          content,
          media_url,
          media_assets,
          approval_status
        ),
        social_connections (
          platform,
          page_name
        )
      `)
      .eq("campaign_posts.tenant_id", userData.tenant_id)
      .order("scheduled_for", { ascending: true });

    reqLogger.event('info', {
      area: 'queue',
      op: 'status.fetch',
      status: 'ok',
      tenantId: userData.tenant_id,
      msg: 'Queue status fetched',
      meta: { count: queueItems?.length || 0 },
    })
    return NextResponse.json({ queue: queueItems || [] });
  } catch (error) {
    reqLogger.error('Error fetching queue status', {
      area: 'queue',
      op: 'status.fetch',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json(
      { error: "Failed to fetch queue status" },
      { status: 500 }
    );
  }
}
