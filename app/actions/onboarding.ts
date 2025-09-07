'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function completeOnboarding(formData: {
  businessType: string
  brandVoice: string
  targetAudience: string
  brandIdentity: string
  brandColor: string
  // Business details (optional)
  phone?: string
  whatsappEnabled?: boolean
  whatsapp?: string
  servesFood?: boolean
  servesDrinks?: boolean
  websiteUrl?: string
  bookingUrl?: string
  menuFoodUrl?: string
  menuDrinkUrl?: string
  logoFile?: string | null
}) {
  const supabase = await createClient()
  
  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    throw new Error('Not authenticated')
  }

  // Get user metadata
  const pubName = user.user_metadata?.pub_name || "My Pub"
  const fullName = user.user_metadata?.full_name || ""
  const firstName = user.user_metadata?.first_name || fullName.split(' ')[0] || ""
  const lastName = user.user_metadata?.last_name || fullName.split(' ').slice(1).join(' ') || ""

  // Use RPC to create tenant atomically (bypasses RLS deadlock)
  const { data: result, error: tenantError } = await supabase
    .rpc('create_tenant_and_assign', {
      p_name: pubName,
      p_business_type: formData.businessType,
      p_brand_voice: formData.brandVoice,
      p_target_audience: formData.targetAudience,
      p_brand_identity: formData.brandIdentity,
      p_brand_color: formData.brandColor
    })

  if (tenantError) {
    console.error("Tenant creation failed:", tenantError)
    throw tenantError
  }

  if (!result?.tenant_id) {
    throw new Error("Tenant creation succeeded but no ID returned")
  }

  const tenantId = result.tenant_id

  // Update user metadata if needed
  const { data: verifyUser } = await supabase
    .from("users")
    .select("id, tenant_id, first_name")
    .eq("id", user.id)
    .single()

  if (!verifyUser?.first_name || verifyUser.first_name === user.email?.split('@')[0]) {
    await supabase
      .from("users")
      .update({
        full_name: fullName || user.email?.split('@')[0] || 'User',
        first_name: firstName || fullName.split(' ')[0] || user.email?.split('@')[0] || 'User',
        last_name: lastName || '',
      })
      .eq('id', user.id)
  }

  // Handle logo upload if provided (base64 data)
  if (formData.logoFile) {
    try {
      // Parse base64 data
      const matches = formData.logoFile.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
      if (matches && matches.length === 3) {
        const contentType = matches[1]
        const base64Data = matches[2]
        const fileExt = contentType.split('/')[1] || 'png'
        const fileName = `${tenantId}/logo-${Date.now()}.${fileExt}`
        
        // Convert base64 to Buffer (Node-safe)
        const buffer = Buffer.from(base64Data, 'base64')
        const blob = new Blob([buffer], { type: contentType })
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("media")
          .upload(fileName, blob)

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from("media")
            .getPublicUrl(fileName)

          // Save logo reference
          await supabase
            .from("tenant_logos")
            .insert({
              tenant_id: tenantId,
              logo_type: 'default',
              file_url: publicUrl,
              file_name: `logo.${fileExt}`,
            })

          // Enable watermarking by default
          await supabase
            .from("watermark_settings")
            .insert({
              tenant_id: tenantId,
              enabled: true,
              auto_apply: false,
            })
        }
      }
    } catch (error) {
      console.error("Logo upload error:", error)
      // Don't fail onboarding if logo upload fails
    }
  }

  // Update business details if provided
  try {
    const { toUkDialDigits } = await import('@/lib/utils/format')
    const phoneDigits = formData.phone ? toUkDialDigits(formData.phone) : ''
    const whatsappDigits = formData.whatsappEnabled && formData.whatsapp ? toUkDialDigits(formData.whatsapp) : ''

    await supabase
      .from('brand_profiles')
      .upsert({
        tenant_id: tenantId,
        phone_e164: phoneDigits ? `+${phoneDigits}` : null,
        whatsapp_e164: whatsappDigits ? `+${whatsappDigits}` : null,
        website_url: formData.websiteUrl || null,
        booking_url: formData.bookingUrl || null,
        menu_food_url: formData.menuFoodUrl || null,
        menu_drink_url: formData.menuDrinkUrl || null,
        serves_food: formData.servesFood ?? false,
        serves_drinks: formData.servesDrinks ?? true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' })
  } catch (e) {
    console.error('Failed to save business details during onboarding:', e)
    // Continue; not fatal to onboarding
  }

  // Revalidate the dashboard to ensure fresh data
  revalidatePath('/dashboard')
  revalidatePath('/onboarding')
  
  // Redirect server-side for atomicity
  redirect('/dashboard')
}
