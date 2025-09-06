'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateBrand(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const tenantId = formData.get('tenant_id') as string
  const brandVoice = formData.get('brand_voice') as string
  const targetAudience = formData.get('target_audience') as string
  const brandIdentity = formData.get('brand_identity') as string
  const brandColor = (formData.get('brand_color_hex') as string) || (formData.get('brand_color') as string)
  
  if (!tenantId) {
    return { error: 'Missing tenant ID' }
  }
  
  // Verify user has access to this tenant
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  
  if (userError || userData?.tenant_id !== tenantId) {
    return { error: 'Unauthorised' }
  }
  
  // Upsert brand profile
  const { error: upsertError } = await supabase
    .from('brand_profiles')
    .upsert({
      tenant_id: tenantId,
      brand_voice: brandVoice || null,
      target_audience: targetAudience || null,
      brand_identity: brandIdentity || null,
      primary_color: brandColor || '#EA580C',
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id'
    })
  
  if (upsertError) {
    console.error('Error updating brand profile:', upsertError)
    return { error: 'Failed to update brand profile' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/brand')
  
  return { success: true }
}
