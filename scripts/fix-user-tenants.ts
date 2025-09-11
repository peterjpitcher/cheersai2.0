/*
  Fix users.tenant_id for users who have content under a different tenant via membership.
  Usage:
    - npx tsx scripts/fix-user-tenants.ts --email you@example.com
    - npx tsx scripts/fix-user-tenants.ts --apply-all   (process all users)
*/
import dotenv from 'dotenv'
// Load .env.local first if present, then .env fallback
dotenv.config({ path: '.env.local' })
dotenv.config()
import { createClient } from '@supabase/supabase-js'

type UserRow = { id: string; email: string | null; tenant_id: string | null }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE envs. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function parseArgs() {
  const args = process.argv.slice(2)
  const out: { email?: string; applyAll?: boolean } = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email') out.email = args[++i]
    else if (args[i] === '--apply-all') out.applyAll = true
  }
  return out
}

async function countForTenant(tenantId: string) {
  // Count posts via campaign join + quick posts without campaign
  const { count: postsFromCampaigns } = await supabase
    .from('campaign_posts')
    .select('id, campaign!inner(tenant_id)', { count: 'exact', head: true })
    .eq('campaign.tenant_id', tenantId)
  const { count: quickPosts } = await supabase
    .from('campaign_posts')
    .select('id', { count: 'exact', head: true })
    .is('campaign_id', null)
    .eq('tenant_id', tenantId)
  const { count: campaignCount } = await supabase
    .from('campaigns')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  const posts = (postsFromCampaigns || 0) + (quickPosts || 0)
  return { posts, campaigns: campaignCount || 0 }
}

async function fixUser(u: UserRow) {
  // Get memberships
  const { data: memberships, error: memErr } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, created_at')
    .eq('user_id', u.id)

  if (memErr) throw memErr
  if (!memberships || memberships.length === 0) {
    console.log(`- ${u.email} has no memberships; skipping`)
    return
  }

  // Tally content by tenant
  const stats: Array<{ tenant_id: string; posts: number; campaigns: number; role: string; created_at: string }> = []
  for (const m of memberships) {
    const { posts, campaigns } = await countForTenant(m.tenant_id)
    stats.push({ tenant_id: m.tenant_id, posts, campaigns, role: m.role, created_at: m.created_at })
  }

  // Choose best tenant: most posts, then most campaigns, then owner, then earliest
  stats.sort((a, b) => {
    if (b.posts !== a.posts) return b.posts - a.posts
    if (b.campaigns !== a.campaigns) return b.campaigns - a.campaigns
    if (a.role !== b.role) return (a.role === 'owner' ? -1 : 1)
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const best = stats[0]
  const current = u.tenant_id
  console.log(`- ${u.email} current=${current} best=${best.tenant_id} posts=${best.posts} campaigns=${best.campaigns}`)

  // Only switch if current is null or current has 0 posts and best has >0 posts
  let currentStats: { posts: number; campaigns: number } = { posts: 0, campaigns: 0 }
  if (current) currentStats = await countForTenant(current)

  const shouldSwitch = !current || (current !== best.tenant_id && best.posts > 0 && currentStats.posts === 0)

  if (shouldSwitch) {
    const { error: updErr } = await supabase
      .from('users')
      .update({ tenant_id: best.tenant_id, onboarding_complete: true, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (updErr) throw updErr
    console.log(`  -> updated users.tenant_id to ${best.tenant_id} and set onboarding_complete=true`)
  } else {
    console.log('  -> no change needed')
  }
}

async function main() {
  const { email, applyAll } = parseArgs()
  if (!email && !applyAll) {
    console.error('Usage: --email <email> OR --apply-all')
    process.exit(1)
  }

  if (email) {
    const { data: u } = await supabase
      .from('users')
      .select('id, email, tenant_id')
      .eq('email', email)
      .maybeSingle()
    if (!u) {
      console.error(`User not found: ${email}`)
      process.exit(1)
    }
    await fixUser(u as UserRow)
    return
  }

  // Apply to all users
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, tenant_id')
  if (error) throw error
  for (const u of users as UserRow[]) {
    try {
      await fixUser(u)
    } catch (e) {
      console.error(`Error fixing ${u.email}:`, e)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
