'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateAccount(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const firstName = formData.get('first_name') as string
  const lastName = formData.get('last_name') as string
  const tenantName = formData.get('tenant_name') as string
  const businessType = formData.get('business_type') as string
  const weekStartRaw = formData.get('week_start')
  const weekStart = weekStartRaw === 'sunday' || weekStartRaw === 'monday' ? weekStartRaw : null
  
  // Validate inputs
  if (!firstName || !lastName || !tenantName) {
    return { error: 'Missing required fields' }
  }
  
  // Get user's tenant_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  
  if (userError || !userData?.tenant_id) {
    return { error: 'Failed to get user data' }
  }
  
  // Update user information
  const { error: updateUserError } = await supabase
    .from('users')
    .update({
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)
  
  if (updateUserError) {
    console.error('Error updating user:', updateUserError)
    return { error: 'Failed to update user information' }
  }
  
  // Update tenant information
  const { error: updateTenantError } = await supabase
    .from('tenants')
    .update({
      name: tenantName,
      business_type: businessType,
      updated_at: new Date().toISOString()
    })
    .eq('id', userData.tenant_id)
  
  if (updateTenantError) {
    console.error('Error updating tenant:', updateTenantError)
    return { error: 'Failed to update business information' }
  }
  
  // Upsert user week_start preference
  if (weekStart === 'sunday' || weekStart === 'monday') {
    const upsert = await supabase
      .from('user_prefs')
      .upsert({ user_id: user.id, week_start: weekStart }, { onConflict: 'user_id' })
    if (upsert.error) {
      console.error('Error updating week_start preference:', upsert.error)
      // Non-fatal; continue
    }
  }
  
  // Revalidate and redirect
  revalidatePath('/settings/account')
  
  return { success: true }
}
