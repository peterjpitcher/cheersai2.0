import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client'
import { getBaseUrl } from '@/lib/utils/get-app-url'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest) {
  try {
    const service = await createServiceRoleClient()
    // Find pending GMB connections
    const { data: conns, error } = await service
      .from('social_connections')
      .select('*')
      .eq('platform', 'google_my_business')
      .or('account_id.eq.pending,metadata->>status.eq.pending_quota_approval')

    if (error) {
      console.error('Fetch pending GMB conns error:', error)
      return NextResponse.json({ processed: 0, error: 'fetch_failed' }, { status: 500 })
    }

    let processed = 0
    for (const c of conns || []) {
      try {
        if (!c.refresh_token) continue
        const client = new GoogleMyBusinessClient({
          clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
          redirectUri: `${getBaseUrl()}/api/auth/google-my-business/callback`,
          refreshToken: c.refresh_token,
          accessToken: c.access_token || undefined,
          tenantId: c.tenant_id,
        })

        const accounts = await client.getAccounts()
        if (!accounts || accounts.length === 0) continue
        const accountName = accounts[0].name || accounts[0].accountName || accounts[0].accountId
        const locations = await client.getLocations(accountName)
        if (!locations || locations.length === 0) continue
        const loc = locations[0]

        const { error: upErr } = await service.from('social_connections').update({
          account_id: accountName,
          account_name: accounts[0].accountName || accounts[0].name || accounts[0].title || 'Business Profile',
          page_id: loc?.name || loc?.locationId,
          page_name: loc?.locationName || loc?.title,
          is_active: true,
          metadata: { promoted_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq('id', c.id)
        if (upErr) throw upErr
        processed++
      } catch (e) {
        console.warn('GMB promote pending failed for connection', c.id, e)
      }
    }

    return NextResponse.json({ processed })
  } catch (e) {
    console.error('GMB refresh cron error:', e)
    return NextResponse.json({ error: 'cron_failed' }, { status: 500 })
  }
}
