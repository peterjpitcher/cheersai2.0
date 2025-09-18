import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFacebookPageAccessToken } from "@/lib/social/facebook";
import { decryptToken } from "@/lib/security/encryption";
import { z } from 'zod'
import { publishPostSchema } from '@/lib/validation/schemas'
import { unauthorized, badRequest, forbidden, ok, serverError, rateLimited } from '@/lib/http'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { safeLog } from '@/lib/scrub'
import crypto from 'crypto'
import { hasPermission, PERMISSIONS } from '@/lib/authz'
import { preflight } from '@/lib/preflight'
import { extractFirstUrl, mergeUtm, replaceUrl } from '@/lib/utm'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { mapProviderError } from '@/lib/errors'
import { captureException } from '@/lib/observability/sentry'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const reqLogger = createRequestLogger(request as unknown as Request)
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get tenant id for rate-limiting and idempotency scoping
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = userData?.tenant_id as string | undefined;

    const raw = await request.json();
    const baseSchema = z.object(publishPostSchema.shape).extend({
      content: z.string().min(1),
      imageUrl: z.string().url().optional(),
      scheduleFor: z.string().datetime().optional(),
      gmbOptions: z.record(z.unknown()).optional(),
      trackLinks: z.boolean().optional(),
    })
    const parsed = baseSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid publish payload', parsed.error.format(), request)
    }
    const { postId, content, connectionIds, imageUrl, scheduleFor, gmbOptions, trackLinks } = parsed.data

    // Rate limit publish attempts per user and per tenant
    const { user: uLimit, tenant: tLimit } = await enforceUserAndTenantLimits({
      userId: user.id,
      tenantId: tenantId,
      userLimit: { requests: 60, window: '1 m' },
      tenantLimit: { requests: 300, window: '1 m' },
    })
    const now = Date.now();
    const failed = [uLimit, tLimit].filter(r => r && !r.success) as NonNullable<typeof uLimit>[]
    if (failed.length > 0) {
      const soonestReset = Math.min(...failed.map(f => f.reset))
      const retryAfter = Math.max(0, Math.ceil((soonestReset - now) / 1000))
      return rateLimited('Publish rate limit exceeded', retryAfter, { scope: 'publish' }, request)
    }

    // Idempotency: if header present and prior result exists, return cached
    const idempotencyKey = request.headers.get('idempotency-key') || request.headers.get('Idempotency-Key') || undefined;
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ postId, content, connectionIds, imageUrl, scheduleFor, gmbOptions })).digest('hex');
    if (idempotencyKey && tenantId) {
      const { data: prior } = await supabase
        .from('idempotency_keys')
        .select('id, request_hash, response_json, created_at')
        .eq('tenant_id', tenantId)
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (prior && prior.request_hash === requestHash) {
        // within 24h considered valid
        const created = new Date(prior.created_at as unknown as string);
        if (Date.now() - created.getTime() < 24 * 60 * 60 * 1000) {
          return ok(prior.response_json || { results: [] }, request)
        }
      }
    }

    // Check post, permissions, and approvals before publishing
    const { data: post } = await supabase
      .from("campaign_posts")
      .select("approval_status, campaign_id, tenant_id, is_publishing")
      .eq("id", postId)
      .single();
    if (!post) {
      return badRequest('invalid_post', 'Post not found', undefined, request)
    }
    if (post.is_publishing) {
      return forbidden('This post is currently being published. Please wait.', undefined, request)
    }
    if (!(await hasPermission(user.id, post.tenant_id, PERMISSIONS.POST_PUBLISH))) {
      return forbidden('You do not have permission to publish posts', undefined, request)
    }
    const { data: approval } = await supabase
      .from('post_approvals')
      .select('required, approved_count, state')
      .eq('tenant_id', post.tenant_id)
      .eq('post_id', postId)
      .maybeSingle()
    const quotaMet = approval ? (approval.state === 'approved' || (approval.approved_count || 0) >= (approval.required || 1)) : (post.approval_status === 'approved')
    if (!quotaMet) {
      return forbidden('Post must be approved before publishing', { required: approval?.required || 1, approved: approval?.approved_count || 0 }, request)
    }

    const results: Array<Record<string, unknown>> = [];
    let encounteredFailure = false;
    const lockStartedAt = Date.now()

    // Lock post to prevent race condition while publishing
    await supabase.from('campaign_posts').update({ is_publishing: true }).eq('id', postId)

    let thrownError: unknown

    try {
    for (const connectionId of connectionIds) {
      // Get connection details
      const { data: connection } = await supabase
        .from("social_connections")
        .select("*")
        .eq("id", connectionId)
        .single();

      if (!connection || !connection.is_active) {
        encounteredFailure = true
        results.push({
          connectionId,
          success: false,
          error: "Connection not found or inactive",
        });
        continue;
      }

      if (scheduleFor && new Date(scheduleFor) > new Date()) {
        // Pre-checks for platform-specific requirements before scheduling
        if ((connection.platform === 'instagram' || connection.platform === 'instagram_business') && !imageUrl) {
          encounteredFailure = true
          results.push({
            connectionId,
            success: false,
            error: 'Instagram requires an image',
          });
          continue;
        }

        // Preflight length/content checks using platform-aware counting
        const pf = preflight(content, connection.platform)
        if (pf.overall === 'fail') {
          encounteredFailure = true
          results.push({ connectionId, success: false, error: 'Preflight failed', details: pf.findings })
          continue
        }

        // Add to publishing queue for scheduled posting
        const { error: queueError } = await supabase
          .from("publishing_queue")
          .insert({
            campaign_post_id: postId,
            social_connection_id: connectionId,
            scheduled_for: scheduleFor,
            status: "pending",
          });

        if (queueError) {
          encounteredFailure = true
          results.push({
            connectionId,
            success: false,
            error: "Failed to schedule post",
          });
        } else {
          results.push({
            connectionId,
            success: true,
            scheduled: true,
          });
        }
      } else {
        // Publish immediately
        try {
          let publishResult;
          const textToPost = content

          // Use the venue's original link as written; no shortening or UTM rewriting
          // This preserves brand domain in posts per product decision.

          // Preflight after URL replacements so counters are realistic
          const pf = preflight(textToPost, connection.platform)
          if (pf.overall === 'fail') {
            encounteredFailure = true
            results.push({ connectionId, success: false, error: 'Preflight failed', details: pf.findings })
            continue
          }

          const platformKey = String(connection.platform || '').toLowerCase().trim()
          if (platformKey === 'twitter') {
            encounteredFailure = true
            results.push({ connectionId, success: false, error: 'Twitter is not supported' })
            continue;
          }
          switch (platformKey) {
            case "facebook":
              {
                const pageToken = connection.access_token_encrypted
                  ? decryptToken(connection.access_token_encrypted)
                  : connection.access_token;
              publishResult = await publishToFacebook(
                connection.page_id,
                pageToken,
                textToPost,
                imageUrl
              );
              break;
              }

            case "instagram":
            case "instagram_business":
              // Instagram requires business account and different API
              {
                const igToken = connection.access_token_encrypted
                  ? decryptToken(connection.access_token_encrypted)
                  : connection.access_token;
              publishResult = await publishToInstagram(
                connection.page_id,
                igToken,
                textToPost,
                imageUrl
              );
              break;
              }

            case "twitter": {
              throw new Error('Unsupported platform');
            }

            case "google_my_business": {
              const gmbAccess = connection.access_token_encrypted
                ? decryptToken(connection.access_token_encrypted)
                : connection.access_token;
              // If this post belongs to a Special Offer campaign, use the campaign's date as the offer end date
              let augmented = gmbOptions;
              try {
                const { data: camp } = await supabase
                  .from('campaigns')
                  .select('campaign_type, event_date')
                  .eq('id', post.campaign_id)
                  .maybeSingle();
                const isOffer = String(camp?.campaign_type || '').toLowerCase().includes('offer');
                if (isOffer && camp?.event_date) {
                  const endDate = new Date(camp.event_date).toISOString().slice(0,10);
                  augmented = { ...(gmbOptions || {}), offer: { ...((gmbOptions || {}).offer || {}), offer_valid_to: endDate } };
                }
              } catch {}
              publishResult = await publishToGoogleMyBusinessImmediate(
                textToPost,
                imageUrl,
                { ...connection, access_token: gmbAccess },
                augmented
              );
              break;
            }

            default:
              throw new Error("Unsupported platform");
          }

          // Record in publishing history
          const { data: ph } = await supabase
            .from("publishing_history")
            .insert({
              campaign_post_id: postId,
              social_connection_id: connectionId,
              platform: connection.platform,
              status: "published",
              published_at: new Date().toISOString(),
              platform_post_id: publishResult.id,
              external_id: publishResult.id,
              account_name: connection.page_name || connection.account_name,
              connection_id: connectionId,
              post_type: connection.platform === 'google_my_business' ? (publishResult as any).postType || null : null,
            })
            .select('id')
            .single();

          // Audit log
          try {
            const { data: userRow } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
            await supabase.from('audit_log').insert({
              tenant_id: userRow?.tenant_id || null,
              user_id: user.id,
              entity_type: 'campaign_post',
              entity_id: String(postId),
              action: 'publish',
              meta: { platform: connection.platform, connection_id: connectionId, platform_post_id: publishResult.id }
            })
          } catch {}

          // Short link tracking removed - not currently implemented

          // PQL event
          try {
            const { recordPqlEvent } = await import('@/lib/pql')
            await recordPqlEvent(post.tenant_id, user.id, 'publish_succeeded', { platform: connection.platform })
          } catch {}

          reqLogger.event('info', {
            area: 'publish',
            op: `${connection.platform}.publish`,
            status: 'ok',
            platform: connection.platform,
            connectionId: String(connectionId),
            tenantId: String(connection.tenant_id || ''),
            msg: 'Immediate publish succeeded'
          })
          results.push({
            connectionId,
            success: true,
            postId: publishResult.id,
          });
        } catch (error: any) {
          const mapped = mapProviderError(error, (connection.platform || 'generic') as any)
          encounteredFailure = true
          // Record failure
          await supabase
            .from("publishing_history")
            .insert({
              campaign_post_id: postId,
              social_connection_id: connectionId,
              platform: connection.platform,
              status: "failed",
              error_message: mapped.message,
              account_name: connection.page_name || connection.account_name,
              connection_id: connectionId,
            });

          // Audit failure
          try {
            const { data: userRow } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
            await supabase.from('audit_log').insert({
              tenant_id: userRow?.tenant_id || null,
              user_id: user.id,
              entity_type: 'campaign_post',
              entity_id: String(postId),
              action: 'publish_failed',
              meta: { platform: connection.platform, connection_id: connectionId, error: mapped.message }
            })
          } catch {}

          reqLogger.event('warn', {
            area: 'publish',
            op: `${connection.platform}.publish`,
            status: 'fail',
            platform: connection.platform,
            connectionId: String(connectionId),
            tenantId: String(connection.tenant_id || ''),
            errorCode: mapped.code,
            msg: mapped.message
          })
          captureException(error, { tags: { area: 'publish', platform: connection.platform, op: 'immediate' } })
          results.push({
            connectionId,
            success: false,
            error: mapped.message,
            errorCode: mapped.code,
          });
        }
      }
    }

    const responsePayload = { results };

    // Store idempotency result for 24h if key provided
    if (idempotencyKey && tenantId) {
      await supabase
        .from('idempotency_keys')
        .upsert({ tenant_id: tenantId, idempotency_key: idempotencyKey, request_hash: requestHash, response_json: responsePayload })
        .throwOnError();
    }

    return ok(responsePayload, request)
    } catch (error) {
      thrownError = error
      throw error
    } finally {
      const { error: unlockError } = await supabase
        .from('campaign_posts')
        .update({ is_publishing: false })
        .eq('id', postId)
      const durationMs = Date.now() - lockStartedAt
      const hadFailure = encounteredFailure || Boolean(thrownError)
      const logMeta = { postId, tenantId: post.tenant_id, durationMs, hadFailure }
      if (unlockError) {
        reqLogger.event('warn', {
          area: 'publish',
          op: 'post.unlock',
          status: 'fail',
          msg: 'Failed to release publish lock',
          tenantId: String(post.tenant_id),
          meta: logMeta,
        })
        logger.error('Failed to release publish lock', {
          ...logMeta,
          error: unlockError,
        })
      } else {
        reqLogger.event('info', {
          area: 'publish',
          op: 'post.unlock',
          status: 'ok',
          msg: 'Publish lock released',
          tenantId: String(post.tenant_id),
          meta: logMeta,
        })
      }
    }
  } catch (error) {
    safeLog("Publishing error:", error);
    captureException(error, { tags: { area: 'publish', op: 'handler' } })
    return serverError('Failed to publish content', undefined, request)
  }
}

const facebookServiceFetch = createServiceFetch('facebook')
const instagramServiceFetch = createServiceFetch('instagram')
const googleServiceFetch = createServiceFetch('google')

const facebookFetch = (url: string, init?: RequestInit) =>
  withRetry(() => facebookServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  })

const instagramFetch = (url: string, init?: RequestInit) =>
  withRetry(() => instagramServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 2000,
  })

const googleFetch = (url: string, init?: RequestInit) =>
  withRetry(() => googleServiceFetch(url, init), {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 3000,
  })

async function publishToFacebook(
  pageId: string,
  pageAccessToken: string,
  message: string,
  imageUrl?: string
): Promise<{ id: string, postType?: string }> {
  // We already store a PAGE access token during connect; no exchange needed here
  const base = `https://graph.facebook.com/v18.0/${pageId}/`;

  if (imageUrl) {
    const params = new URLSearchParams();
    params.set('message', message);
    params.set('url', imageUrl);
    params.set('access_token', pageAccessToken);

    const response = await facebookFetch(base + 'photos', { method: 'POST', body: params });
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || data.error) {
      const msg = data.error?.message || text || 'Failed to post photo to Facebook';
      throw new Error(msg);
    }
    return { id: data.id };
  } else {
    const params = new URLSearchParams();
    params.set('message', message);
    params.set('access_token', pageAccessToken);

    const response = await facebookFetch(base + 'feed', { method: 'POST', body: params });
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || data.error) {
      const msg = data.error?.message || text || 'Failed to post to Facebook feed';
      throw new Error(msg);
    }
    return { id: data.id };
  }
}

async function publishToInstagram(
  pageId: string,
  accessToken: string,
  caption: string,
  imageUrl?: string
): Promise<{ id: string }> {
  if (!imageUrl) {
    throw new Error("Instagram requires an image");
  }

  // Get Instagram Business Account ID
  const accountResponse = await instagramFetch(
    `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`
  );
  const accountData = await accountResponse.json();
  
  if (!accountData.instagram_business_account) {
    throw new Error("No Instagram Business Account connected to this Facebook Page");
  }

  const igAccountId = accountData.instagram_business_account.id;

  // Create media container (use form-encoded params for Graph API reliability)
  const containerParams = new URLSearchParams();
  containerParams.set('image_url', imageUrl);
  containerParams.set('caption', caption);
  containerParams.set('access_token', accessToken);
  const containerResponse = await instagramFetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    { method: 'POST', body: containerParams }
  );
  const containerText = await containerResponse.text();
  let containerData: any = {};
  try { containerData = JSON.parse(containerText); } catch {}
  if (!containerResponse.ok || containerData.error) {
    const msg = containerData.error?.message || containerText || 'Failed to create Instagram container';
    throw new Error(msg);
  }

  // Publish the container
  const publishParams = new URLSearchParams();
  publishParams.set('creation_id', containerData.id);
  publishParams.set('access_token', accessToken);
  const publishResponse = await instagramFetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    { method: 'POST', body: publishParams }
  );
  const publishText = await publishResponse.text();
  let publishData: any = {};
  try { publishData = JSON.parse(publishText); } catch {}
  if (!publishResponse.ok || publishData.error) {
    const msg = publishData.error?.message || publishText || 'Failed to publish Instagram media';
    throw new Error(msg);
  }

  return { id: publishData.id };
}

// Twitter helpers removed

// --- Google Business Profile immediate publish (text-only minimal) ---
async function publishToGoogleMyBusinessImmediate(
  text: string,
  imageUrl: string | undefined,
  connection: any,
  gmbOptions?: any
): Promise<{ id: string }> {
  const { GoogleMyBusinessClient } = await import('@/lib/social/google-my-business/client');
  const { mapToGbpPayload } = await import('@/lib/gbp/mapper');

  const client = new GoogleMyBusinessClient({
    clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-my-business/callback`,
    accessToken: connection.access_token || undefined,
    refreshToken: connection.refresh_token || undefined,
    tenantId: connection.tenant_id,
  });

  // Normalize account and location IDs
  const accountId = normalizeAccountId(connection.account_id);
  const locationId = normalizeLocationId(connection.page_id);

  const mapped = mapToGbpPayload({
    type: (gmbOptions?.event ? 'EVENT' : (gmbOptions?.offer ? 'OFFER' : 'UPDATE')) as any,
    text,
    imageUrl: imageUrl || '',
    cta: normalizeGmbCta(gmbOptions?.callToAction),
    event: normalizeGmbEvent(gmbOptions?.event),
    offer: normalizeGmbOffer(gmbOptions?.offer),
  })
  const res = await client.createPost(accountId, locationId, mapped.payload);
  if (!res.success || !res.postId) {
    throw new Error(res.error || 'Failed to create GMB post');
  }
  return { id: res.postId };
}

function normalizeAccountId(accountId: string | null): string {
  if (!accountId) return '';
  // strip leading 'accounts/' if present
  if (accountId.startsWith('accounts/')) return accountId.split('/')[1] || '';
  return accountId;
}

function normalizeLocationId(loc: string | null): string {
  if (!loc) return '';
  // possible forms: 'locations/123', 'accounts/456/locations/123', or bare '123'
  const parts = loc.split('/');
  const idx = parts.lastIndexOf('locations');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  if (loc.startsWith('locations/')) return loc.split('/')[1] || '';
  return loc;
}

function normalizeGmbCta(cta: any): any {
  if (!cta || !cta.actionType) return undefined
  const map: Record<string, string> = {
    'BOOK': 'BOOK',
    'ORDER': 'ORDER',
    'SHOP': 'SHOP',
    'LEARN_MORE': 'LEARN_MORE',
    'SIGN_UP': 'SIGN_UP',
    'GET_OFFER': 'LEARN_MORE',
    'CALL': 'CALL_NOW'
  }
  const actionType = map[String(cta.actionType).toUpperCase()] || 'LEARN_MORE'
  const out: any = { actionType }
  if (cta.url) out.url = cta.url
  if (cta.phone) out.phoneNumber = cta.phone
  return out
}

function normalizeGmbEvent(event: any): any {
  if (!event || !event.schedule) return undefined
  const s = event.schedule
  // Build ISO strings if date/time provided
  function toIso(date?: string, time?: string) {
    if (!date) return undefined
    if (!time) return date
    try { return new Date(`${date}T${time}`).toISOString() } catch { return date }
  }
  return {
    event_start: toIso(s.startDate, s.startTime),
    event_end: toIso(s.endDate, s.endTime)
  }
}

function normalizeGmbOffer(offer: any): any {
  if (!offer) return undefined
  return {
    coupon_code: offer.couponCode || undefined,
    redeem_url: offer.redeemOnlineUrl || undefined,
    offer_valid_from: undefined,
    offer_valid_to: undefined,
  }
}

async function createOrGetShortLinkSlug(
  supabase: any,
  tenantId: string,
  targetUrl: string,
  campaignId: string | null,
  platform: string,
  connectionId: string
): Promise<string | null> {
  // Try to reuse existing slug if existing record for same target + platform exists
  const { data: existing } = await supabase
    .from('short_links')
    .select('slug')
    .eq('tenant_id', tenantId)
    .eq('target_url', targetUrl)
    .eq('platform', platform)
    .maybeSingle()
  if (existing?.slug) return existing.slug

  const slug = generateSlug()
  const { error } = await supabase
    .from('short_links')
    .insert({ tenant_id: tenantId, slug, target_url: targetUrl, campaign_id: campaignId, platform, connection_id: connectionId })
  if (error) return null
  return slug
}

function generateSlug(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 7; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}
