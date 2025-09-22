import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/server-only'
import { ok, unauthorized, badRequest, serverError } from '@/lib/http'

export const runtime = 'nodejs'

type TenantRow = { tenant_id: string | null }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return unauthorized('Authentication required', userErr?.message, req)
    }

    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return badRequest('missing_image', 'Missing image file', undefined, req)
    }

    const svc = await createServiceRoleClient()

    // Resolve tenant for namespacing and DB write
    const { data: userRow, error: fetchUserErr } = await svc
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single<TenantRow>()

    if (fetchUserErr || !userRow?.tenant_id) {
      return badRequest('tenant_not_found', 'Tenant not found', fetchUserErr?.message, req)
    }

    // Normalize extension and content type
    const originalName = file.name || 'upload'
    const originalExt = originalName.split('.').pop()?.toLowerCase()
    const isHEIC = originalExt === 'heic' || originalExt === 'heif'
    const finalExt = isHEIC ? 'jpg' : (originalExt || 'jpg')
    const contentType = isHEIC ? 'image/jpeg' : (file.type || 'image/jpeg')

    const path = `${userRow.tenant_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${finalExt}`

    // Upload using service role to avoid storage policy blockers
    const { error: uploadErr } = await svc.storage
      .from('media')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })

    if (uploadErr) {
      return serverError('Failed to upload media asset', { message: uploadErr.message }, req)
    }

    // Public URL
    const { data: pub } = svc.storage.from('media').getPublicUrl(path)
    const publicUrl = pub.publicUrl

    // Insert DB row
    const { data: asset, error: dbErr } = await svc
      .from('media_assets')
      .insert({
        tenant_id: userRow.tenant_id,
        file_url: publicUrl,
        file_name: originalName,
        file_type: contentType,
        file_size: file.size || null,
      })
      .select('id,file_url,file_name')
      .single()

    if (dbErr) {
      // best-effort cleanup
      await svc.storage.from('media').remove([path]).catch(() => {})
      return serverError('Failed to save media metadata', { message: dbErr.message }, req)
    }

    return ok({ asset }, req)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return serverError('Unexpected media upload error', { message: err.message }, req)
  }
}
