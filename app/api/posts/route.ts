import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unauthorized, ok } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized('Authentication required')
  const filter = request.nextUrl.searchParams.get('filter')
  const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  let posts: any[] = []
  if (filter === 'pending-approval') {
    // Posts with approvals pending
    const { data: list } = await supabase
      .from('campaign_posts')
      .select('id, approval_status, campaign:campaigns(name)')
      .eq('tenant_id', u?.tenant_id)
      .order('created_at', { ascending: false })
      .limit(50)
    posts = (list || []).filter(p => p.approval_status !== 'approved')
  }
  return ok({ posts })
}

