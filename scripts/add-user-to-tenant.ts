/*
  Add a user (by email) to a tenant. Choose tenant by --tenant-id or by --owner-email (picks owner tenant with most posts).
  Usage:
    - npx tsx scripts/add-user-to-tenant.ts --user-email user@example.com --tenant-id <uuid>
    - npx tsx scripts/add-user-to-tenant.ts --user-email user@example.com --owner-email owner@example.com
*/
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE envs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function args() {
  const out: any = {}
  const a = process.argv.slice(2)
  for (let i = 0; i < a.length; i++) {
    const k = a[i]
    if (k === '--user-email') out.userEmail = a[++i]
    else if (k === '--tenant-id') out.tenantId = a[++i]
    else if (k === '--owner-email') out.ownerEmail = a[++i]
  }
  return out
}

async function countPosts(tenantId: string) {
  const { count: fromCampaigns } = await supabase
    .from('campaign_posts')
    .select('id, campaign!inner(tenant_id)', { count: 'exact', head: true })
    .eq('campaign.tenant_id', tenantId)
  const { count: quick } = await supabase
    .from('campaign_posts')
    .select('id', { count: 'exact', head: true })
    .is('campaign_id', null)
    .eq('tenant_id', tenantId)
  return (fromCampaigns || 0) + (quick || 0)
}

async function resolveTenantId(ownerEmail: string): Promise<string | null> {
  const { data: owner } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('email', ownerEmail)
    .maybeSingle()
  if (!owner) return null
  // Collect memberships
  const { data: mems } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, created_at')
    .eq('user_id', owner.id)
  if (!mems || mems.length === 0) return owner.tenant_id
  // Choose with most posts
  let best: { id: string; posts: number } | null = null
  for (const m of mems) {
    const posts = await countPosts(m.tenant_id)
    if (!best || posts > best.posts) best = { id: m.tenant_id, posts }
  }
  return best?.id || owner.tenant_id
}

async function main() {
  const { userEmail, tenantId, ownerEmail } = args()
  if (!userEmail || (!tenantId && !ownerEmail)) {
    console.error('Usage: --user-email <email> --tenant-id <uuid> | --owner-email <email>')
    process.exit(1)
  }

  const { data: user } = await supabase.from('users').select('id, email').eq('email', userEmail).maybeSingle()
  if (!user) {
    console.error('Target user not found:', userEmail)
    process.exit(1)
  }

  let targetTenantId = tenantId as string | undefined
  if (!targetTenantId && ownerEmail) {
    targetTenantId = await resolveTenantId(ownerEmail) || undefined
  }
  if (!targetTenantId) {
    console.error('Could not resolve tenant id')
    process.exit(1)
  }

  // Insert membership and set users.tenant_id
  const { error: insErr } = await supabase
    .from('user_tenants')
    .insert({ user_id: user.id, tenant_id: targetTenantId, role: 'admin' })
  if (insErr && !String(insErr.message).includes('duplicate')) {
    console.error('Failed to insert membership:', insErr)
    process.exit(1)
  }
  const { error: updErr } = await supabase
    .from('users')
    .update({ tenant_id: targetTenantId, onboarding_complete: true, updated_at: new Date().toISOString() })
    .eq('id', user.id)
  if (updErr) {
    console.error('Failed to update users.tenant_id:', updErr)
    process.exit(1)
  }

  console.log(`Linked ${userEmail} to tenant ${targetTenantId} and set onboarding_complete=true`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

