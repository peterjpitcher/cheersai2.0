#!/usr/bin/env node
// Safe tenant soft-delete script
// Usage:
//  node scripts/admin/delete-tenant.mjs --name "The Anchor" --exclude 303e9600-7ab9-47e8-9cbf-d8d6c37ea8c8 [--hard] [--dry-run]

import { createClient } from '@supabase/supabase-js'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--hard') args.hard = true
    else if (a === '--dry-run') args.dry = true
    else if (a === '--name') { args.name = argv[++i] }
    else if (a === '--exclude') { args.exclude = argv[++i] }
    else if (a === '--id') { args.id = argv[++i] }
  }
  return args
}

async function main() {
  const { name, exclude, id, hard, dry } = parseArgs(process.argv)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  if (!name && !id) {
    console.error('Provide --name or --id to target a tenant')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }})

  // Resolve candidates
  let tenants
  if (id) {
    const { data, error } = await supabase.from('tenants').select('*').eq('id', id)
    if (error) throw error
    tenants = data
  } else {
    const { data, error } = await supabase.from('tenants').select('*').eq('name', name)
    if (error) throw error
    tenants = data
  }

  // Exclude protected tenant
  const candidates = tenants.filter(t => !exclude || t.id !== exclude)
  if (candidates.length === 0) {
    console.log('No matching tenants to delete (after applying exclude guard).')
    process.exit(0)
  }

  console.log(`Found ${candidates.length} tenant(s) to ${hard ? 'HARD' : 'SOFT'} delete:`)
  for (const t of candidates) {
    console.log(`- ${t.id} | ${t.name} | status=${t.subscription_status} | tier=${t.subscription_tier}`)
  }

  if (dry) {
    console.log('Dry-run enabled. No changes made.')
    process.exit(0)
  }

  for (const t of candidates) {
    if (hard) {
      console.log(`Hard-deleting tenant ${t.id} (${t.name})`)
      // Known tables that carry tenant_id. Delete dependents first.
      const tablesInOrder = [
        'publishing_history',
        'publishing_queue',
        'ai_generation_feedback',
        'analytics',
        'api_usage',
        'performance_metrics',
        'error_logs',
        'data_exports',
        'brand_voice_samples',
        'brand_voice_profiles',
        'content_guardrails_history',
        'content_guardrails',
        'media_assets',
        'posting_schedules',
        'social_connections',
        'social_accounts',
        'campaign_posts',
        'campaign_templates',
        'campaigns',
        'brand_profiles',
        'tenant_logos',
        'user_deletion_requests',
        'user_tenants',
        'superadmin_audit_log', // uses target_tenant_id; handle specially
      ]

      // Delete by tenant_id
      for (const table of tablesInOrder) {
        if (table === 'superadmin_audit_log') {
          await supabase.from(table).delete().eq('target_tenant_id', t.id)
        } else {
          await supabase.from(table).delete().eq('tenant_id', t.id)
        }
      }
      // Finally delete tenant row
      const { error: delTenantErr } = await supabase.from('tenants').delete().eq('id', t.id)
      if (delTenantErr) throw delTenantErr
      console.log(`Hard-deleted tenant ${t.id}`)
    } else {
      const { error } = await supabase.from('tenants').update({ deleted_at: new Date().toISOString(), subscription_status: 'canceled' }).eq('id', t.id)
      if (error) throw error
      console.log(`Soft-deleted tenant ${t.id} (${t.name})`)
    }
  }

  console.log('Done.')
}

main().catch(err => {
  console.error('Delete script failed:', err)
  process.exit(1)
})
