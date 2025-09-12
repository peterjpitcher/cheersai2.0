import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const { slug } = resolvedParams
  const supabase = await createClient()
  const { data: link } = await supabase
    .from('short_links')
    .select('id, target_url')
    .eq('slug', slug)
    .single()
  if (!link) return NextResponse.redirect('/', 302)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || '0.0.0.0'
  const ua = request.headers.get('user-agent') || ''
  const referer = request.headers.get('referer') || ''
  const platformHint = request.headers.get('sec-ch-ua-platform') || ''
  const daySalt = new Date().toISOString().slice(0, 10)
  const ip_hash = await sha256(ip + '|' + daySalt)
  const ua_hash = await sha256(ua + '|' + daySalt)
  await supabase.from('short_clicks').insert({ link_id: link.id, ip_hash, ua_hash, referer, platform_hint: platformHint }).throwOnError()

  return NextResponse.redirect(link.target_url, 302)
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
