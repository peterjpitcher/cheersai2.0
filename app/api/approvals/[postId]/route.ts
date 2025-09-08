import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { unauthorized, badRequest, ok, forbidden } from '@/lib/http'
import { hasPermission, PERMISSIONS } from '@/lib/authz'

export const runtime = 'nodejs'

const actionSchema = z.object({
  action: z.enum(['approve','reject','request_changes','comment']),
  comment: z.string().optional(),
  platform_scope: z.string().optional(),
})

export async function GET(_req: NextRequest, { params }: { params: { postId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')

  const { data: post } = await supabase.from('campaign_posts').select('id, tenant_id, approval_status').eq('id', params.postId).single()
  if (!post) return badRequest('not_found', 'Post not found')

  const [{ data: approval }, { data: comments }] = await Promise.all([
    supabase.from('post_approvals').select('*').eq('post_id', post.id).eq('tenant_id', post.tenant_id).maybeSingle(),
    supabase.from('post_comments').select('*').eq('post_id', post.id).order('created_at', { ascending: true }),
  ])
  return ok({ approval, comments })
}

export async function PATCH(request: NextRequest, { params }: { params: { postId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const body = await request.json()
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return badRequest('validation_error', 'Invalid action', parsed.error.format())

  const { data: post } = await supabase.from('campaign_posts').select('id, tenant_id').eq('id', params.postId).single()
  if (!post) return badRequest('not_found', 'Post not found')

  const canApprove = await hasPermission(user.id, post.tenant_id, PERMISSIONS.POST_APPROVE)
  if (!canApprove) return forbidden('You do not have permission to approve posts')

  const { action, comment, platform_scope } = parsed.data
  // Ensure approval row exists; default required from tenant setting
  const { data: tenant } = await supabase.from('tenants').select('approvals_required').eq('id', post.tenant_id).single()
  await supabase.from('post_approvals').upsert({ tenant_id: post.tenant_id, post_id: post.id, required: tenant?.approvals_required || 1 }, { onConflict: 'tenant_id,post_id' }).throwOnError()

  if (action === 'approve') {
    // increment approved_count and set state if quota met
    const { data: approval } = await supabase.from('post_approvals').select('*').eq('tenant_id', post.tenant_id).eq('post_id', post.id).single()
    const next = (approval?.approved_count || 0) + 1
    const required = approval?.required || 1
    const state = next >= required ? 'approved' : 'pending'
    await supabase.from('post_approvals').update({ approved_count: next, state }).eq('tenant_id', post.tenant_id).eq('post_id', post.id)
  } else if (action === 'reject') {
    await supabase.from('post_approvals').update({ state: 'rejected' }).eq('tenant_id', post.tenant_id).eq('post_id', post.id)
  } else if (action === 'request_changes') {
    await supabase.from('post_approvals').update({ state: 'changes_requested' }).eq('tenant_id', post.tenant_id).eq('post_id', post.id)
  }

  if (comment) {
    await supabase.from('post_comments').insert({ tenant_id: post.tenant_id, post_id: post.id, author_id: user.id, type: action === 'request_changes' ? 'change_request' : 'note', platform_scope, body: comment })
  }

  const { data: approval } = await supabase.from('post_approvals').select('*').eq('tenant_id', post.tenant_id).eq('post_id', post.id).single()
  return ok({ approval })
}
