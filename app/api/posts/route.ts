import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unauthorized, ok } from '@/lib/http'
import type { Database } from '@/lib/types/database'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const filter = request.nextUrl.searchParams.get('filter')
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  const tenantId = u?.tenant_id

  type PendingPost = {
    id: string
    approval_status: Database['public']['Tables']['campaign_posts']['Row']['approval_status']
    campaign: { name: string | null } | null
  }

  let posts: PendingPost[] = []
  if (filter === 'pending-approval') {
    if (!tenantId) {
      return ok({ posts })
    }
    const tenantKey = tenantId
    // Posts with approvals pending
    const { data: list } = await supabase
      .from('campaign_posts')
      .select('id, approval_status, campaign:campaigns(name)')
      .eq('tenant_id', tenantKey)
      .order('created_at', { ascending: false })
      .limit(50)
      .returns<PendingPost[]>()
    posts = (list || []).filter(p => p.approval_status !== 'approved')
  }
  return ok({ posts })
}
