import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/server-only'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const svc = await createServiceRoleClient()

    // Lookup tenant_id via service role to avoid RLS edge cases
    const { data: userRow, error: fetchUserErr } = await svc
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (fetchUserErr || !userRow?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), { status: 400 })
    }

    const { data: assets, error: assetsErr } = await svc
      .from('media_assets')
      .select('id,file_url,file_name,tags,created_at')
      .eq('tenant_id', userRow.tenant_id)
      .order('created_at', { ascending: false })

    if (assetsErr) {
      return new Response(JSON.stringify({ error: assetsErr.message }), { status: 500 })
    }

    return new Response(JSON.stringify({ assets: assets ?? [] }), { status: 200 })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Unexpected error' }), { status: 500 })
  }
}
