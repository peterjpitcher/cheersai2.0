'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function uploadLogo(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  const file = formData.get('file') as File
  const tenantId = formData.get('tenant_id') as string
  
  if (!file || !tenantId) {
    return { error: 'Missing required fields' }
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
  
  try {
    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer())
    const fileExt = file.name.split('.').pop() || 'png'
    const fileName = `${tenantId}/logo-${Date.now()}.${fileExt}`
    
    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('media')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false
      })
    
    if (uploadError) {
      console.error('Upload error:', uploadError)
      return { error: 'Failed to upload file' }
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(fileName)
    
    // Check if this is the first logo
    const { count } = await supabase
      .from('tenant_logos')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    
    // Save logo reference
    const { error: insertError } = await supabase
      .from('tenant_logos')
      .insert({
        tenant_id: tenantId,
        logo_type: 'default',
        file_url: publicUrl,
        file_name: file.name,
        is_active: count === 0 // Set as active if it's the first logo
      })
    
    if (insertError) {
      console.error('Insert error:', insertError)
      return { error: 'Failed to save logo' }
    }
    
    // Revalidate the page
    revalidatePath('/settings/logo')
    
    return { success: true }
  } catch (error) {
    console.error('Unexpected error:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteLogo(logoId: string) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get logo details and verify ownership
  const { data: logo, error: logoError } = await supabase
    .from('tenant_logos')
    .select('*, tenants!inner(id)')
    .eq('id', logoId)
    .single()
  
  if (logoError || !logo) {
    return { error: 'Logo not found' }
  }
  
  // Verify user has access to this tenant
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  
  if (userError || userData?.tenant_id !== logo.tenant_id) {
    return { error: 'Unauthorised' }
  }
  
  // Don't allow deleting active logo
  if (logo.is_active) {
    return { error: 'Cannot delete active logo. Please set another logo as active first.' }
  }
  
  // Delete from database
  const { error: deleteError } = await supabase
    .from('tenant_logos')
    .delete()
    .eq('id', logoId)
  
  if (deleteError) {
    console.error('Delete error:', deleteError)
    return { error: 'Failed to delete logo' }
  }
  
  // Optionally delete from storage (extract path from URL)
  try {
    const url = new URL(logo.file_url)
    const path = url.pathname.split('/').slice(-2).join('/')
    
    await supabase.storage
      .from('media')
      .remove([path])
  } catch (error) {
    console.error('Storage cleanup error:', error)
    // Don't fail the operation if storage cleanup fails
  }
  
  // Revalidate the page
  revalidatePath('/settings/logo')
  
  return { success: true }
}

export async function setActiveLogo(logoId: string) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get logo details and verify ownership
  const { data: logo, error: logoError } = await supabase
    .from('tenant_logos')
    .select('tenant_id')
    .eq('id', logoId)
    .single()
  
  if (logoError || !logo) {
    return { error: 'Logo not found' }
  }
  
  // Verify user has access to this tenant
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  
  if (userError || userData?.tenant_id !== logo.tenant_id) {
    return { error: 'Unauthorised' }
  }
  
  // Start a transaction to update logos
  // First, set all logos as inactive
  const { error: deactivateError } = await supabase
    .from('tenant_logos')
    .update({ is_active: false })
    .eq('tenant_id', logo.tenant_id)
  
  if (deactivateError) {
    console.error('Deactivate error:', deactivateError)
    return { error: 'Failed to update logos' }
  }
  
  // Then set the selected logo as active
  const { error: activateError } = await supabase
    .from('tenant_logos')
    .update({ is_active: true })
    .eq('id', logoId)
  
  if (activateError) {
    console.error('Activate error:', activateError)
    return { error: 'Failed to set active logo' }
  }
  
  // Update watermark settings timestamp
  await supabase
    .from('watermark_settings')
    .upsert({
      tenant_id: logo.tenant_id,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id'
    })
  
  // Revalidate the page
  revalidatePath('/settings/logo')
  
  return { success: true }
}

export async function updateWatermarkSettings(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const tenantId = formData.get('tenant_id') as string
  const enabled = formData.get('enabled') === 'on'
  const autoApply = formData.get('auto_apply') === 'on'
  const position = formData.get('position') as string
  const opacity = parseFloat(formData.get('opacity') as string)
  const sizePercent = parseInt(formData.get('size_percent') as string)
  const marginPixels = parseInt(formData.get('margin_pixels') as string)
  
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
  
  // Upsert watermark settings
  const { error: upsertError } = await supabase
    .from('watermark_settings')
    .upsert({
      tenant_id: tenantId,
      enabled,
      auto_apply: autoApply,
      position,
      opacity,
      size_percent: sizePercent,
      margin_pixels: marginPixels,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id'
    })
  
  if (upsertError) {
    console.error('Upsert error:', upsertError)
    return { error: 'Failed to save watermark settings' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/logo')
  
  return { success: true }
}
