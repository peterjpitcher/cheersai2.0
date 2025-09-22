import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ok, unauthorized, badRequest, serverError } from '@/lib/http'

export const runtime = 'nodejs'

type TenantRow = { tenant_id: string | null }
type MediaAssetRow = {
  id: string
  file_url: string | null
  file_name: string | null
  file_type: string | null
  file_size: number | null
  tags: string[] | null
  created_at: string | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return unauthorized('Authentication required', userErr?.message, request)
    }

    // Lookup tenant_id via service role to avoid RLS edge cases
    const { data: userRow, error: fetchUserErr } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single<TenantRow>()

    if (fetchUserErr || !userRow?.tenant_id) {
      return badRequest('tenant_not_found', 'Tenant not found for user', fetchUserErr?.message, request)
    }

    const { data: assets, error: assetsErr } = await supabase
      .from('media_assets')
      .select('id,file_url,file_name,file_type,file_size,tags,created_at')
      .eq('tenant_id', userRow.tenant_id)
      .order('created_at', { ascending: false })
      .returns<MediaAssetRow[]>()

    if (assetsErr) {
      return serverError('Failed to fetch media assets', { message: assetsErr.message }, request)
    }

    return ok({ assets: assets ?? [] }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return serverError('Unexpected media list error', { message: err.message }, request)
  }
}
