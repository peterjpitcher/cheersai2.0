import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Database } from '@/lib/types/database'

type User = Database['public']['Tables']['users']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type BrandProfile = Database['public']['Tables']['brand_profiles']['Row']
type Logo = Database['public']['Tables']['tenant_logos']['Row']
type WatermarkSettings = Database['public']['Tables']['watermark_settings']['Row']
type Subscription = Database['public']['Tables']['subscriptions']['Row']
type PostingSchedule = Database['public']['Tables']['posting_schedules']['Row']
type SocialAccount = Database['public']['Tables']['social_accounts']['Row']

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
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !authUser) {
    redirect('/auth/login')
  }
  
  // Get user data with tenant
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select(`
      *,
      tenants!inner(*)
    `)
    .eq('id', authUser.id)
    .single()
  
  if (userError || !userData) {
    redirect('/auth/login')
  }
  
  // Check if user has a tenant
  if (!userData.tenant_id) {
    redirect('/onboarding')
  }
  
  // Get full tenant data
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', userData.tenant_id)
    .single()
  
  if (tenantError || !tenant) {
    redirect('/onboarding')
  }
  
  return {
    user: userData as User,
    tenant
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
    console.error('Error fetching brand profile:', error)
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
    console.error('Error fetching logos:', error)
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
    console.error('Error fetching watermark settings:', error)
    return null
  }
  
  return data
}

/**
 * Get subscription for a tenant
 */
export async function getSubscription(tenantId: string): Promise<Subscription | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .single()
  
  if (error) {
    console.error('Error fetching subscription:', error)
    return null
  }
  
  return data
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
    console.error('Error fetching posting schedule:', error)
    return []
  }
  
  return data || []
}

/**
 * Get social accounts for a tenant
 */
export async function getSocialAccounts(tenantId: string): Promise<SocialAccount[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching social accounts:', error)
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