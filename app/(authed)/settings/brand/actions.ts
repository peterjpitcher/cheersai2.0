'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
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
  const phone = (formData.get('phone') as string) || ''
  const whatsappEnabled = formData.get('whatsapp_enabled') === 'on'
  const whatsapp = (formData.get('whatsapp') as string) || ''
  const websiteUrl = (formData.get('website_url') as string) || ''
  const bookingUrl = (formData.get('booking_url') as string) || ''
  const servesFood = formData.get('serves_food') === 'on'
  const servesDrinks = formData.get('serves_drinks') === 'on'
  const menuFoodUrl = (formData.get('menu_food_url') as string) || ''
  const menuDrinkUrl = (formData.get('menu_drink_url') as string) || ''
  
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
  
  // Upsert brand profile — store phone numbers exactly as entered (no formatting)
  const rawPhone = phone.trim()
  const rawWhatsapp = (whatsappEnabled ? whatsapp.trim() : '')

  // Opening hours JSON (stringified)
  type BrandProfileUpdate = Database['public']['Tables']['brand_profiles']['Update']
  let openingHours: BrandProfileUpdate['opening_hours'] = null
  try {
    const raw = formData.get('opening_hours') as string
    if (raw) openingHours = JSON.parse(raw) as BrandProfileUpdate['opening_hours']
  } catch {}

  let { error: upsertError } = await supabase
    .from('brand_profiles')
    .upsert({
      tenant_id: tenantId,
      brand_voice: brandVoice || null,
      target_audience: targetAudience || null,
      brand_identity: brandIdentity || null,
      primary_color: brandColor || null,
      phone: rawPhone || null,
      whatsapp: rawWhatsapp || null,
      website_url: websiteUrl || null,
      booking_url: bookingUrl || null,
      serves_food: servesFood,
      serves_drinks: servesDrinks,
      menu_food_url: menuFoodUrl || null,
      menu_drink_url: menuDrinkUrl || null,
      opening_hours: openingHours,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'tenant_id'
    })
  // Backward-compatibility: if columns not found, retry with legacy names
  if (upsertError && 'code' in upsertError && upsertError.code === '42703') {
    const retry = await supabase
      .from('brand_profiles')
      .upsert({
        tenant_id: tenantId,
        brand_voice: brandVoice || null,
        target_audience: targetAudience || null,
        brand_identity: brandIdentity || null,
        primary_color: brandColor || null,
        phone_e164: rawPhone || null,
        whatsapp_e164: rawWhatsapp || null,
        website_url: websiteUrl || null,
        booking_url: bookingUrl || null,
        serves_food: servesFood,
        serves_drinks: servesDrinks,
        menu_food_url: menuFoodUrl || null,
        menu_drink_url: menuDrinkUrl || null,
        opening_hours: openingHours,
        updated_at: new Date().toISOString()
      }, { onConflict: 'tenant_id' })
    upsertError = retry.error
  }

  if (upsertError) {
    console.error('Error updating brand profile:', upsertError)
    return { error: 'Failed to update brand profile' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/brand')
  
  return { success: true }
}
