import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/security/encryption";
import { z } from 'zod'
import { publishPostSchema } from '@/lib/validation/schemas'
import { unauthorized, badRequest, forbidden, ok, serverError, rateLimited } from '@/lib/http'
import { enforceUserAndTenantLimits } from '@/lib/rate-limit'
import { safeLog } from '@/lib/scrub'
import crypto from 'crypto'
import { hasPermission, PERMISSIONS } from '@/lib/authz'
import { preflight } from '@/lib/preflight'
import type { PreflightFinding } from '@/lib/preflight'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { mapProviderError } from '@/lib/errors'
import type { Provider } from '@/lib/errors'
import { captureException } from '@/lib/observability/sentry'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'
import { mapToGbpPayload } from '@/lib/gbp/mapper'
import type { GbpCallToAction, GbpEventInfo, GbpOfferInfo } from '@/lib/gbp/mapper'
import type { DatabaseWithoutInternals, Json } from '@/lib/database.types'

export const runtime = 'nodejs'

type SocialConnectionRow = DatabaseWithoutInternals['public']['Tables']['social_connections']['Row']

type SocialConnectionForPublish = Pick<
  SocialConnectionRow,
  | 'id'
  | 'tenant_id'
  | 'platform'
  | 'account_id'
  | 'account_name'
  | 'page_id'
  | 'page_name'
  | 'access_token'
  | 'access_token_encrypted'
  | 'refresh_token'
  | 'refresh_token_encrypted'
  | 'token_expires_at'
  | 'is_active'
>

type PublishResultEntry = {
  connectionId: string
  success: boolean
  error?: string
  errorCode?: string
  scheduled?: boolean
  postId?: string
  details?: Json
}

type PlatformPublishResult = {
  id: string
  permalink?: string | null
  postType?: string | null
}

type RawGmbSchedule = {
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
}

type RawGmbEvent = {
  title?: string
  schedule?: RawGmbSchedule
}

type RawGmbOffer = {
  couponCode?: string
  redeemOnlineUrl?: string
  termsConditions?: string
  offer_valid_from?: string
  offer_valid_to?: string
}

type RawGmbCallToAction = {
  actionType?: string
  url?: string
  phone?: string
}

type RawGmbOptions = {
  callToAction?: RawGmbCallToAction
  event?: RawGmbEvent
  offer?: RawGmbOffer
}

const serializeFindings = (findings: PreflightFinding[]): Json =>
  findings.map((finding) => ({
    level: finding.level,
    code: finding.code,
    message: finding.message,
  })) as Json

const sanitizePublishResult = (entry: PublishResultEntry): Record<string, Json | undefined> => {
  const sanitized: Record<string, Json | undefined> = {
    connectionId: entry.connectionId,
    success: entry.success,
  }
  if (typeof entry.error !== 'undefined') sanitized.error = entry.error
  if (typeof entry.errorCode !== 'undefined') sanitized.errorCode = entry.errorCode
  if (typeof entry.scheduled !== 'undefined') sanitized.scheduled = entry.scheduled
  if (typeof entry.postId !== 'undefined') sanitized.postId = entry.postId
  if (typeof entry.details !== 'undefined') sanitized.details = entry.details
  return sanitized
}

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
    const { postId, content, connectionIds, imageUrl, scheduleFor } = parsed.data
    const trackLinks = parsed.data.trackLinks ?? false
    const gmbOptions = parseGmbOptions(parsed.data.gmbOptions)

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
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ postId, content, connectionIds, imageUrl, scheduleFor, gmbOptions, trackLinks }))
      .digest('hex');
    if (idempotencyKey && tenantId) {
      const tenantScope = tenantId
      const { data: prior } = await supabase
        .from('idempotency_keys')
        .select('id, request_hash, response_json, created_at')
        .eq('tenant_id', tenantScope)
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
    if (!post.tenant_id) {
      return serverError('Post missing tenant context', undefined, request)
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

    const results: PublishResultEntry[] = [];
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
        .select('id, tenant_id, platform, account_id, account_name, page_id, page_name, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_expires_at, is_active')
        .eq("id", connectionId)
        .single<SocialConnectionForPublish>();

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
        results.push({ connectionId, success: false, error: 'Preflight failed', details: serializeFindings(pf.findings) })
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
        const provider = mapPlatformToProvider(connection.platform)
        try {
          let publishResult: PlatformPublishResult | null = null;
          const textToPost = content

          // Use the venue's original link as written; no shortening or UTM rewriting
          // This preserves brand domain in posts per product decision.

          // Preflight after URL replacements so counters are realistic
          const pf = preflight(textToPost, connection.platform)
          if (pf.overall === 'fail') {
            encounteredFailure = true
            results.push({ connectionId, success: false, error: 'Preflight failed', details: serializeFindings(pf.findings) })
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
              publishResult = await publishToFacebook({
                pageId: connection.page_id,
                pageAccessToken: pageToken,
                message: textToPost,
                imageUrl,
              });
              break;
              }

            case "instagram":
            case "instagram_business":
              // Instagram requires business account and different API
              {
              const igToken = connection.access_token_encrypted
                ? decryptToken(connection.access_token_encrypted)
                : connection.access_token;
                if (!igToken) {
                  throw new Error('Missing Instagram access token')
                }
              if (!connection.page_id) {
                throw new Error('Instagram connection missing page identifier')
              }
              if (!imageUrl) {
                throw new Error('Instagram requires an image')
              }
              publishResult = await publishToInstagram({
                pageId: connection.page_id,
                accessToken: igToken,
                caption: textToPost,
                imageUrl,
              });
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
              let augmented: RawGmbOptions | undefined = gmbOptions;
              try {
                if (post.campaign_id) {
                  const { data: camp } = await supabase
                    .from('campaigns')
                    .select('campaign_type, event_date')
                    .eq('id', post.campaign_id)
                    .maybeSingle();
                  const isOffer = String(camp?.campaign_type || '').toLowerCase().includes('offer');
                  if (isOffer && camp?.event_date) {
                    const endDate = new Date(camp.event_date).toISOString().slice(0, 10);
                    augmented = {
                      ...(gmbOptions ?? {}),
                      offer: {
                        ...(gmbOptions?.offer ?? {}),
                        offer_valid_to: endDate,
                      },
                    };
                  }
                }
              } catch {}
              publishResult = await publishToGoogleMyBusinessImmediate({
                text: textToPost,
                imageUrl,
                connection,
                accessToken: gmbAccess,
                gmbOptions: augmented,
              });
              break;
            }

            default:
              throw new Error("Unsupported platform");
          }

          // Record in publishing history
          if (!publishResult) {
            throw new Error('Publish result missing')
          }

          await supabase
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
              post_type: connection.platform === 'google_my_business' ? publishResult.postType ?? null : null,
            });

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
            msg: 'Immediate publish succeeded',
            meta: { provider },
          })
          results.push({
            connectionId,
            success: true,
            postId: publishResult.id,
          });
        } catch (unknownError) {
          const err = unknownError instanceof Error ? unknownError : new Error(String(unknownError))
          const mapped = mapProviderError(err, provider)
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
          captureException(err, { tags: { area: 'publish', platform: connection.platform, op: 'immediate' } })
          results.push({
            connectionId,
            success: false,
            error: mapped.message,
            errorCode: mapped.code,
          });
        }
      }
    }

    const responsePayload = { results }

    // Store idempotency result for 24h if key provided
    if (idempotencyKey && tenantId) {
      const sanitized = { results: results.map(sanitizePublishResult) }
      const idempotencyPayload = JSON.parse(JSON.stringify(sanitized)) as Json

      await supabase
        .from('idempotency_keys')
        .upsert({ tenant_id: tenantId, idempotency_key: idempotencyKey, request_hash: requestHash, response_json: idempotencyPayload })
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

type FacebookGraphResponse = {
  id?: string
  post_id?: string
  error?: { message?: string }
}

type PublishToFacebookParams = {
  pageId: string | null
  pageAccessToken: string | null
  message: string
  imageUrl?: string
}

async function publishToFacebook({ pageId, pageAccessToken, message, imageUrl }: PublishToFacebookParams): Promise<PlatformPublishResult> {
  if (!pageId) {
    throw new Error('Missing Facebook Page identifier')
  }
  if (!pageAccessToken) {
    throw new Error('Missing Facebook access token')
  }

  const base = `https://graph.facebook.com/v18.0/${pageId}/`
  const endpoint = imageUrl ? `${base}photos` : `${base}feed`
  const params = new URLSearchParams({ message, access_token: pageAccessToken })
  if (imageUrl) {
    params.set('url', imageUrl)
  }

  const response = await facebookFetch(endpoint, { method: 'POST', body: params })
  const text = await response.text()
  const data = safeJsonParse<FacebookGraphResponse>(text) ?? {}
  if (!response.ok || data.error) {
    const msg = data.error?.message || text || 'Failed to publish to Facebook'
    throw new Error(msg)
  }
  const id = data.id ?? data.post_id
  if (!id) {
    throw new Error('Facebook response did not include a post id')
  }
  return { id, permalink: `https://facebook.com/${id}` }
}

type PublishToInstagramParams = {
  pageId: string
  accessToken: string
  caption: string
  imageUrl: string
}

type InstagramBusinessAccountResponse = {
  instagram_business_account?: { id?: string }
}

type InstagramGraphResponse = {
  id?: string
  error?: { message?: string }
}

async function publishToInstagram({ pageId, accessToken, caption, imageUrl }: PublishToInstagramParams): Promise<PlatformPublishResult> {

  const accountResponse = await instagramFetch(
    `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`
  )
  const accountData = (await accountResponse.json()) as InstagramBusinessAccountResponse

  const igAccountId = accountData.instagram_business_account?.id
  if (!accountResponse.ok || !igAccountId) {
    throw new Error('No Instagram Business Account connected to this Facebook Page')
  }

  const containerParams = new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  })
  const containerResponse = await instagramFetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    { method: 'POST', body: containerParams }
  )
  const containerText = await containerResponse.text()
  const containerData = safeJsonParse<InstagramGraphResponse>(containerText) ?? {}
  if (!containerResponse.ok || containerData.error || !containerData.id) {
    const msg = containerData.error?.message || containerText || 'Failed to create Instagram container'
    throw new Error(msg)
  }

  const publishParams = new URLSearchParams({
    creation_id: containerData.id,
    access_token: accessToken,
  })
  const publishResponse = await instagramFetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    { method: 'POST', body: publishParams }
  )
  const publishText = await publishResponse.text()
  const publishData = safeJsonParse<InstagramGraphResponse>(publishText) ?? {}
  if (!publishResponse.ok || publishData.error || !publishData.id) {
    const msg = publishData.error?.message || publishText || 'Failed to publish Instagram media'
    throw new Error(msg)
  }

  return { id: publishData.id }
}

type PublishToGoogleMyBusinessParams = {
  text: string
  imageUrl?: string
  connection: SocialConnectionForPublish
  accessToken: string | null
  gmbOptions?: RawGmbOptions
}

async function publishToGoogleMyBusinessImmediate({
  text,
  imageUrl,
  connection,
  accessToken,
  gmbOptions,
}: PublishToGoogleMyBusinessParams): Promise<PlatformPublishResult> {
  const { GoogleMyBusinessClient } = await import('@/lib/social/google-my-business/client')

  const client = new GoogleMyBusinessClient({
    clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-my-business/callback`,
    accessToken: accessToken || undefined,
    refreshToken: connection.refresh_token || undefined,
    tenantId: connection.tenant_id || undefined,
    connectionId: connection.id,
  })

  const accountId = normalizeAccountId(connection.account_id)
  const locationId = normalizeLocationId(connection.page_id)
  const postType = gmbOptions?.event ? 'EVENT' : gmbOptions?.offer ? 'OFFER' : 'UPDATE'
  const mapped = mapToGbpPayload({
    type: postType,
    text,
    imageUrl: imageUrl || '',
    cta: normalizeGmbCta(gmbOptions?.callToAction),
    event: normalizeGmbEvent(gmbOptions?.event),
    offer: normalizeGmbOffer(gmbOptions?.offer),
  })
  const res = await client.createPost(accountId, locationId, mapped.payload)
  if (!res.success || !res.postId) {
    throw new Error(res.error || 'Failed to create GMB post')
  }
  return { id: res.postId, permalink: res.searchUrl ?? null, postType: mapped.postType }
}

function normalizeAccountId(accountId: string | null): string {
  if (!accountId) return ''
  if (accountId.startsWith('accounts/')) return accountId.split('/')[1] || ''
  return accountId
}

function normalizeLocationId(loc: string | null): string {
  if (!loc) return ''
  const parts = loc.split('/')
  const idx = parts.lastIndexOf('locations')
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]
  if (loc.startsWith('locations/')) return loc.split('/')[1] || ''
  return loc
}

function normalizeGmbCta(cta?: RawGmbCallToAction): GbpCallToAction | undefined {
  if (!cta || typeof cta.actionType !== 'string') return undefined
  const map: Record<string, GbpCallToAction['actionType']> = {
    BOOK: 'BOOK',
    ORDER: 'ORDER',
    SHOP: 'SHOP',
    LEARN_MORE: 'LEARN_MORE',
    SIGN_UP: 'SIGN_UP',
    GET_OFFER: 'GET_OFFER',
    CALL: 'CALL',
  }
  const actionType = map[cta.actionType.toUpperCase()] ?? 'LEARN_MORE'
  const result: GbpCallToAction = { actionType }
  if (typeof cta.url === 'string' && cta.url.trim()) result.url = cta.url
  if (typeof cta.phone === 'string' && cta.phone.trim()) result.phone = cta.phone
  return result
}

function normalizeGmbEvent(event?: RawGmbEvent): GbpEventInfo | undefined {
  if (!event || !event.schedule) return undefined
  const schedule = event.schedule
  const start = toIso(schedule.startDate, schedule.startTime)
  if (!start) return undefined
  const end = toIso(schedule.endDate, schedule.endTime)
  return {
    title: typeof event.title === 'string' && event.title.trim().length > 0 ? event.title.trim() : 'Event',
    event_start: start,
    event_end: end,
  }
}

function normalizeGmbOffer(offer?: RawGmbOffer): GbpOfferInfo | undefined {
  if (!offer) return undefined
  return {
    coupon_code: offer.couponCode || undefined,
    redeem_url: offer.redeemOnlineUrl || undefined,
    offer_valid_from: offer.offer_valid_from,
    offer_valid_to: offer.offer_valid_to,
  }
}

function toIso(date?: string, time?: string): string | undefined {
  if (!date) return undefined
  if (!time) return date
  const parsed = new Date(`${date}T${time}`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toISOString()
}

function mapPlatformToProvider(platform: string | null | undefined): Provider {
  if (!platform) return 'generic'
  const key = platform.toLowerCase()
  if (key.includes('instagram')) return 'instagram'
  if (key.includes('facebook')) return 'facebook'
  if (key.includes('google')) return 'gbp'
  return 'generic'
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseGmbOptions(raw: unknown): RawGmbOptions | undefined {
  if (!isPlainObject(raw)) return undefined
  const options: RawGmbOptions = {}

  if (isPlainObject(raw.callToAction)) {
    const cta = raw.callToAction as Record<string, unknown>
    options.callToAction = {
      actionType: typeof cta.actionType === 'string' ? cta.actionType : undefined,
      url: typeof cta.url === 'string' ? cta.url : undefined,
      phone: typeof cta.phone === 'string' ? cta.phone : undefined,
    }
  }

  if (isPlainObject(raw.event)) {
    const event = raw.event as Record<string, unknown>
    let parsedSchedule: RawGmbSchedule | undefined
    if (isPlainObject(event.schedule)) {
      const schedule = event.schedule as Record<string, unknown>
      parsedSchedule = {
        startDate: typeof schedule.startDate === 'string' ? schedule.startDate : undefined,
        startTime: typeof schedule.startTime === 'string' ? schedule.startTime : undefined,
        endDate: typeof schedule.endDate === 'string' ? schedule.endDate : undefined,
        endTime: typeof schedule.endTime === 'string' ? schedule.endTime : undefined,
      }
    }
    options.event = {
      title: typeof event.title === 'string' ? event.title : undefined,
      schedule: parsedSchedule,
    }
  }

  if (isPlainObject(raw.offer)) {
    const offer = raw.offer as Record<string, unknown>
    options.offer = {
      couponCode: typeof offer.couponCode === 'string' ? offer.couponCode : undefined,
      redeemOnlineUrl: typeof offer.redeemOnlineUrl === 'string' ? offer.redeemOnlineUrl : undefined,
      termsConditions: typeof offer.termsConditions === 'string' ? offer.termsConditions : undefined,
      offer_valid_from: typeof offer.offer_valid_from === 'string' ? offer.offer_valid_from : undefined,
      offer_valid_to: typeof offer.offer_valid_to === 'string' ? offer.offer_valid_to : undefined,
    }
  }

  return options
}
