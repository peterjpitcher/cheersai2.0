import { NextRequest } from 'next/server'
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')

  const { data: post } = await supabase
    .from('campaign_posts')
    .select('id, tenant_id, approval_status')
    .eq('id', postId)
    .maybeSingle()

  if (!post || !post.tenant_id) {
    return badRequest('not_found', 'Post not found')
  }

  const tenantId = post.tenant_id

  const [{ data: approval }, { data: comments }] = await Promise.all([
    supabase
      .from('post_approvals')
      .select('*')
      .eq('post_id', post.id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('post_comments')
      .select('*')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true }),
  ])
  return ok({ approval, comments })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const body = await request.json()
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return badRequest('validation_error', 'Invalid action', parsed.error.format())

  const { data: post } = await supabase
    .from('campaign_posts')
    .select('id, tenant_id')
    .eq('id', postId)
    .maybeSingle()

  if (!post || !post.tenant_id) {
    return badRequest('not_found', 'Post not found')
  }

  const tenantId = post.tenant_id

  const canApprove = await hasPermission(user.id, tenantId, PERMISSIONS.POST_APPROVE)
  if (!canApprove) return forbidden('You do not have permission to approve posts')

  const { action, comment, platform_scope: platformScope } = parsed.data
  // Ensure approval row exists with sensible defaults
  const { data: existingApproval } = await supabase
    .from('post_approvals')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('post_id', post.id)
    .maybeSingle()

  let approvalRecord = existingApproval

  if (!approvalRecord) {
    const { data: inserted } = await supabase
      .from('post_approvals')
      .insert({
        tenant_id: tenantId,
        post_id: post.id,
        required: 1,
        approved_count: 0,
        state: 'pending',
      })
      .select()
      .single()

    approvalRecord = inserted ?? null
  }

  const required = approvalRecord?.required ?? 1
  const approvedCount = approvalRecord?.approved_count ?? 0

  if (action === 'approve') {
    const nextApproved = approvedCount + 1
    const nextState = nextApproved >= required ? 'approved' : 'pending'
    await supabase
      .from('post_approvals')
      .update({
        approved_count: nextApproved,
        state: nextState,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('post_id', post.id)
  } else if (action === 'reject') {
    await supabase
      .from('post_approvals')
      .update({ state: 'rejected', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('post_id', post.id)
  } else if (action === 'request_changes') {
    await supabase
      .from('post_approvals')
      .update({ state: 'changes_requested', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('post_id', post.id)
  }

  if (comment) {
    await supabase.from('post_comments').insert({
      tenant_id: tenantId,
      post_id: post.id,
      author_id: user.id,
      type: action === 'request_changes' ? 'change_request' : 'note',
      platform_scope: platformScope ?? null,
      body: comment,
    })
  }

  const { data: approval } = await supabase
    .from('post_approvals')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('post_id', post.id)
    .maybeSingle()

  return ok({ approval })
}
