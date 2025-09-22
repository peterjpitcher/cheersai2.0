import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/database.types'
import type { Database } from '@/lib/types/database'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const { slug } = resolvedParams
  const supabase = await createClient()
  type ShortLink = Pick<Database['public']['Tables']['short_links']['Row'], 'id' | 'destination_url'>

  const { data: link, error: linkError } = await supabase
    .from('short_links')
    .select('id, destination_url')
    .eq('slug', slug)
    .maybeSingle<ShortLink>()
  if (linkError || !link?.destination_url) {
    return NextResponse.redirect(new URL('/', request.url), 302)
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || '0.0.0.0'
  const ua = request.headers.get('user-agent') || ''
  const referer = request.headers.get('referer') || ''
  const platformHint = request.headers.get('sec-ch-ua-platform') || ''
  const daySalt = new Date().toISOString().slice(0, 10)
  const ip_hash = await sha256(ip + '|' + daySalt)
  const ua_hash = await sha256(ua + '|' + daySalt)
  const clickRecord: TablesInsert<'short_clicks'> = {
    link_id: link.id,
    ts: new Date().toISOString(),
    ip: ip,
    user_agent: ua,
    ip_hash,
    ua_hash,
    referer: referer || null,
    platform_hint: platformHint || null,
  }
  await supabase.from('short_clicks').insert(clickRecord).throwOnError()

  return NextResponse.redirect(link.destination_url, 302)
}

async function sha256(input: string) {
  if (typeof crypto !== 'undefined' && 'subtle' in crypto) {
    const enc = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
    return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('')
  }
  // Node fallback
  const node = await import('crypto')
  return node.createHash('sha256').update(input).digest('hex')
}
