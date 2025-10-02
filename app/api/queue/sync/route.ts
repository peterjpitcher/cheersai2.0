import { NextRequest } from 'next/server'
import { ok, badRequest, unauthorized, forbidden } from '@/lib/http'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const bodySchema = z.object({
  postId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
})

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  let postId: string | undefined
  try {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return unauthorized('Authentication required', undefined, request)

    const raw = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return badRequest('validation_error', 'Invalid sync payload', parsed.error.format(), request)
    const { postId: parsedPostId, scheduledFor } = parsed.data
    postId = parsedPostId

    // Resolve tenant for the user
    const { data: u } = await auth.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
    const tenantId = u?.tenant_id as string | undefined
    if (!tenantId) return forbidden('No tenant', undefined, request)

    // Use service role to update queue safely; first verify post belongs to tenant
    const svc = await createServiceRoleClient()
    const { data: post } = await svc
      .from('campaign_posts')
      .select('id, tenant_id')
      .eq('id', postId)
      .maybeSingle()
    if (!post || post.tenant_id !== tenantId) return forbidden('Post not found in tenant', undefined, request)

    // Update the post time to keep source of truth in sync
    await svc.from('campaign_posts').update({ scheduled_for: scheduledFor }).eq('id', postId)

    // Sync pending queue items for this post
    await svc
      .from('publishing_queue')
      .update({
        scheduled_for: scheduledFor,
        next_attempt_at: null,
        attempts: 0,
        last_attempt_at: null,
        last_error: null,
        status: 'pending',
      })
      .eq('campaign_post_id', postId)

    reqLogger.apiResponse('POST', '/api/queue/sync', 200, 0, { area: 'queue', op: 'sync', status: 'ok', postId })
    return ok({ synced: true }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to sync publishing queue', {
      area: 'queue',
      op: 'sync',
      error: err,
      postId,
    })
    return badRequest('sync_failed', 'Failed to sync queue times', undefined, request)
  }
}
