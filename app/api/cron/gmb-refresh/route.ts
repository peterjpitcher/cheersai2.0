import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/server-only'
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client'
import { decryptToken } from '@/lib/security/encryption'
import { getBaseUrl } from '@/lib/utils/get-app-url'
import { unauthorized, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    // Guard: require cron secret or admin context
    const authHeader = req.headers.get('authorization');
    const cronHeader = req.headers.get('x-cron-secret');
    if (process.env.CRON_SECRET) {
      const ok = authHeader === `Bearer ${process.env.CRON_SECRET}` || cronHeader === process.env.CRON_SECRET;
      if (!ok) {
        return unauthorized('Unauthorized', undefined, req)
      }
    }
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
          refreshToken: c.refresh_token_encrypted ? decryptToken(c.refresh_token_encrypted) : c.refresh_token || undefined,
          accessToken: c.access_token_encrypted ? decryptToken(c.access_token_encrypted) : c.access_token || undefined,
          tenantId: c.tenant_id,
          connectionId: c.id,
        })

        const accounts = await client.getAccounts()
        if (!accounts || accounts.length === 0) continue
        const accountName = accounts[0].name || (accounts[0] as any).accountName || accounts[0].accountId
        const locations = await client.getLocations(accountName)
        if (!locations || locations.length === 0) continue
        const loc = locations[0]

        const { error: upErr } = await service.from('social_connections').update({
          account_id: accountName,
          account_name: (accounts[0] as any).accountName || accounts[0].name || (accounts[0] as any).title || 'Business Profile',
          page_id: (loc as any)?.name || (loc as any)?.locationId,
          page_name: (loc as any)?.locationName || (loc as any)?.title,
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

    return ok({ processed }, req)
  } catch (e) {
    console.error('GMB refresh cron error:', e)
    return serverError('cron_failed', undefined, req)
  }
}
