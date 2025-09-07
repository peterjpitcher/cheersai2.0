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
  
  // Upsert brand profile
  // Convert phones to E.164-like with +44 handling (never display +44 in UI)
  let phoneE164: string | null = null
  let whatsappE164: string | null = null
  try {
    const { toUkDialDigits } = await import('@/lib/utils/format')
    if (phone.trim()) phoneE164 = '+' + toUkDialDigits(phone)
    if (whatsappEnabled && whatsapp.trim()) whatsappE164 = '+' + toUkDialDigits(whatsapp)
  } catch {}

  // Opening hours JSON (stringified)
  let openingHours: any = null
  try {
    const raw = formData.get('opening_hours') as string
    if (raw) openingHours = JSON.parse(raw)
  } catch {}

  const { error: upsertError } = await supabase
    .from('brand_profiles')
    .upsert({
      tenant_id: tenantId,
      brand_voice: brandVoice || null,
      target_audience: targetAudience || null,
      brand_identity: brandIdentity || null,
      primary_color: brandColor || '#EA580C',
      phone_e164: phoneE164,
      whatsapp_e164: whatsappE164,
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
  
  if (upsertError) {
    console.error('Error updating brand profile:', upsertError)
    return { error: 'Failed to update brand profile' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/brand')
  
  return { success: true }
}
