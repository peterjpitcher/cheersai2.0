#!/usr/bin/env node
// Upgrade a tenant to Professional (no expiration)
// Usage:
//  node scripts/admin/upgrade-tenant.mjs --id <TENANT_ID> [--dry-run]

import { createClient } from '@supabase/supabase-js'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dry = true
    else if (a === '--id') { args.id = argv[++i] }
  }
  return args
}

async function main() {
  const { id, dry } = parseArgs(process.argv)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  if (!id) {
    console.error('Provide --id <TENANT_ID>')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !tenant) throw error || new Error('Tenant not found')

  console.log('Current:', {
    id: tenant.id,
    name: tenant.name,
    tier: tenant.subscription_tier,
    status: tenant.subscription_status,
    trial_ends_at: tenant.trial_ends_at,
  })

  if (dry) {
    console.log('Dry-run: would set subscription_tier=professional, subscription_status=active, trial_ends_at=null')
    process.exit(0)
  }

  const { error: updError } = await supabase
    .from('tenants')
    .update({
      subscription_tier: 'professional',
      subscription_status: 'active',
      trial_ends_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updError) throw updError

  const { data: after } = await supabase
    .from('tenants')
    .select('id,name,subscription_tier,subscription_status,trial_ends_at')
    .eq('id', id)
    .single()
  console.log('Updated:', after)
}

main().catch(err => {
  console.error('Upgrade script failed:', err)
  process.exit(1)
})

