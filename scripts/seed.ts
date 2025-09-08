#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TENANT_NAME = process.env.SEED_TENANT_NAME || 'Demo Pub Co.'

async function main() {
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, key)

  // Create tenant
  const { data: tenant, error: terr } = await supabase
    .from('tenants')
    .insert({ name: TENANT_NAME, subscription_status: 'trial' })
    .select('id')
    .single()
  if (terr) throw terr

  const tenantId = tenant!.id

  // Create a user placeholder
  const { data: user } = await supabase.from('users').insert({
    email: `demo+${Date.now()}@cheersai.uk`,
    tenant_id: tenantId,
    full_name: 'Demo Owner',
  }).select('id').single()

  // Sample social connections
  await supabase.from('social_connections').insert([
    { tenant_id: tenantId, platform: 'facebook', page_name: 'Demo Pub FB', is_active: true, access_token: 'mock' },
    { tenant_id: tenantId, platform: 'instagram', account_name: 'demo_pub_ig', is_active: true, access_token: 'mock' },
  ])

  // Sample campaign + posts
  const { data: camp } = await supabase.from('campaigns').insert({ tenant_id: tenantId, name: 'Live Music Friday', event_date: new Date().toISOString() }).select('id').single()
  const posts = [
    { tenant_id: tenantId, campaign_id: camp!.id, content: 'Join us for live music this Friday!', approval_status: 'approved', status: 'draft', post_timing: 'day_of_event' },
    { tenant_id: tenantId, campaign_id: camp!.id, content: 'Reserve your table now!', approval_status: 'pending', status: 'draft', post_timing: 'two_days_before' },
  ]
  await supabase.from('campaign_posts').insert(posts)

  console.log('Seeded demo tenant:', tenantId, 'user:', user?.id)
}

main().catch((e) => { console.error(e); process.exit(1) })

