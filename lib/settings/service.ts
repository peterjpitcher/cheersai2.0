import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Database } from '@/lib/types/database'
import { unstable_noStore as noStore } from 'next/cache'
import { logger } from '@/lib/observability/logger'

type User = Database['public']['Tables']['users']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type BrandProfile = Database['public']['Tables']['brand_profiles']['Row']
type Logo = Database['public']['Tables']['tenant_logos']['Row']
type WatermarkSettings = Database['public']['Tables']['watermark_settings']['Row']
type PostingSchedule = Database['public']['Tables']['posting_schedules']['Row']
type SocialAccount = Database['public']['Tables']['social_accounts']['Row']
type SocialConnection = Database['public']['Tables']['social_connections']['Row']
type UserTenantMembership = Database['public']['Tables']['user_tenants']['Row']

export interface UserAndTenant {
  user: User
  tenant: Tenant
}

/**
 * Get authenticated user and their tenant
 * Redirects to login if not authenticated
 * Redirects to onboarding if no tenant
 */
export async function getUserAndTenant(): Promise<UserAndTenant> {
  noStore()
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
  if (authError || !authUser) {
    redirect('/auth/login')
  }

  // Fetch user without inner join to avoid RLS join pitfalls
  const { data: userRow } = await supabase
    .from('users')
    .select<User>('*')
    .eq('id', authUser.id)
    .single()

  if (!userRow) {
    // Create a basic user profile row if missing, then proceed to onboarding
    await supabase.from('users').insert({
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'User',
      first_name: authUser.user_metadata?.first_name || authUser.email?.split('@')[0] || 'User',
      last_name: authUser.user_metadata?.last_name || '',
    })
    redirect('/onboarding')
  }

  // Determine tenant id — prefer users.tenant_id, fall back to membership
  let tenantId = userRow?.tenant_id ?? null
  if (!tenantId) {
    const { data: membership } = await supabase
      .from('user_tenants')
      .select<UserTenantMembership>('tenant_id, role, created_at')
      .eq('user_id', authUser.id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (membership?.tenant_id) {
      tenantId = membership.tenant_id
      // Best-effort: persist onto users to ease future access
      await supabase.from('users').update({ tenant_id: tenantId }).eq('id', authUser.id)
    }
  }

  if (!tenantId) {
    redirect('/onboarding')
  }

  // Load tenant (if RLS blocks the row entirely, treat as no tenant)
  const { data: tenant } = await supabase
    .from('tenants')
    .select<Tenant>('*')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) {
    redirect('/onboarding')
  }

  return {
    user: userRow,
    tenant,
  }
}

/**
 * Get brand profile for a tenant
 */
export async function getBrandProfile(tenantId: string): Promise<BrandProfile | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()
  
  if (error) {
    logger.error('settings_fetch_brand_profile_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return null
  }
  
  return data
}

/**
 * Get logos for a tenant
 */
export async function getLogos(tenantId: string): Promise<Logo[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('tenant_logos')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  
  if (error) {
    logger.error('settings_fetch_logos_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return []
  }
  
  return data || []
}

/**
 * Get watermark settings for a tenant
 */
export async function getWatermarkSettings(tenantId: string): Promise<WatermarkSettings | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('watermark_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()
  
  if (error) {
    logger.error('settings_fetch_watermark_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return null
  }
  
  return data
}

/**
 * Get subscription for a tenant
 */
// Normalise subscription from tenants table (no dedicated subscriptions table)
export async function getSubscription(tenantId: string): Promise<{ tier: string; status: string; trial_ends_at: string | null } | null> {
  const supabase = await createClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('subscription_tier, subscription_status, trial_ends_at')
    .eq('id', tenantId)
    .single()

  if (error) {
    logger.error('settings_fetch_subscription_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return null
  }

  return {
    tier: tenant?.subscription_tier || 'free',
    status: tenant?.subscription_status || (tenant?.trial_ends_at ? 'trialing' : 'inactive'),
    trial_ends_at: tenant?.trial_ends_at || null,
  }
}

/**
 * Get posting schedule for a tenant
 */
export async function getPostingSchedule(tenantId: string): Promise<PostingSchedule[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('posting_schedules')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('day_of_week', { ascending: true })
    .order('time', { ascending: true })
  
  if (error) {
    logger.error('settings_fetch_schedule_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return []
  }
  
  return data || []
}

/**
 * Get social connections for a tenant (new OAuth flow)
 */
export async function getSocialConnections(tenantId: string): Promise<SocialConnection[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('social_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  
  if (error) {
    logger.error('settings_fetch_social_connections_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return []
  }
  
  return data || []
}

/**
 * Get social accounts for a tenant (legacy - keeping for backward compatibility)
 */
export async function getSocialAccounts(tenantId: string): Promise<SocialAccount[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  
  if (error) {
    logger.error('settings_fetch_social_accounts_failed', {
      area: 'admin',
      status: 'fail',
      tenantId,
      error: error ? new Error(error.message) : undefined,
      meta: { code: error?.code },
    })
    return []
  }
  
  return data || []
}

/**
 * Get all settings data for a tenant
 */
export async function getAllSettingsData(tenantId: string) {
  const [
    brandProfile,
    logos,
    watermarkSettings,
    subscription,
    postingSchedule,
    socialAccounts
  ] = await Promise.all([
    getBrandProfile(tenantId),
    getLogos(tenantId),
    getWatermarkSettings(tenantId),
    getSubscription(tenantId),
    getPostingSchedule(tenantId),
    getSocialAccounts(tenantId)
  ])
  
  return {
    brandProfile,
    logos,
    watermarkSettings,
    subscription,
    postingSchedule,
    socialAccounts
  }
}
