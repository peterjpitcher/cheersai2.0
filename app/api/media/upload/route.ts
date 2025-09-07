import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/server-only'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const form = await req.formData()
    const file = form.get('image') as File | null
    if (!file) {
      return new Response(JSON.stringify({ error: 'Missing image file' }), { status: 400 })
    }

    const svc = await createServiceRoleClient()

    // Resolve tenant for namespacing and DB write
    const { data: userRow, error: fetchUserErr } = await svc
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (fetchUserErr || !userRow?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), { status: 400 })
    }

    // Normalize extension and content type
    const originalName = (file as any).name || 'upload'
    const originalExt = originalName.split('.').pop()?.toLowerCase()
    const isHEIC = originalExt === 'heic' || originalExt === 'heif'
    const finalExt = isHEIC ? 'jpg' : (originalExt || 'jpg')
    const contentType = isHEIC ? 'image/jpeg' : (file.type || 'image/jpeg')

    const path = `${userRow.tenant_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${finalExt}`

    // Upload using service role to avoid storage policy blockers
    const { data: uploaded, error: uploadErr } = await svc.storage
      .from('media')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 })
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
        file_size: (file as any).size || null,
      })
      .select('id,file_url,file_name')
      .single()

    if (dbErr) {
      // best-effort cleanup
      await svc.storage.from('media').remove([path]).catch(() => {})
      return new Response(JSON.stringify({ error: dbErr.message }), { status: 500 })
    }

    return new Response(JSON.stringify({ asset }), { status: 200 })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Unexpected error' }), { status: 500 })
  }
}
