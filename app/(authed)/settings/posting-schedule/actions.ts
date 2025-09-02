'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ScheduleSlot {
  id: string
  day_of_week: number
  time: string
  platform: string
  is_active: boolean
}

export async function saveSchedule(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const tenantId = formData.get('tenant_id') as string
  const scheduleJson = formData.get('schedule') as string
  
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
    return { error: 'Unauthorized' }
  }
  
  try {
    const schedule: ScheduleSlot[] = JSON.parse(scheduleJson)
    
    // Start a transaction by deleting existing schedule and inserting new
    // First, delete all existing schedule for this tenant
    const { error: deleteError } = await supabase
      .from('posting_schedules')
      .delete()
      .eq('tenant_id', tenantId)
    
    if (deleteError) {
      console.error('Error deleting schedule:', deleteError)
      return { error: 'Failed to update schedule' }
    }
    
    // Filter out any slots that are just placeholders
    const validSlots = schedule.filter(slot => 
      slot.time && slot.day_of_week >= 0 && slot.day_of_week <= 6
    )
    
    if (validSlots.length > 0) {
      // Prepare data for insertion
      const scheduleData = validSlots.map(slot => ({
        tenant_id: tenantId,
        day_of_week: slot.day_of_week,
        time: slot.time,
        platform: slot.platform || 'all',
        is_active: slot.is_active !== false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }))
      
      // Insert new schedule
      const { error: insertError } = await supabase
        .from('posting_schedules')
        .insert(scheduleData)
      
      if (insertError) {
        console.error('Error inserting schedule:', insertError)
        return { error: 'Failed to save schedule' }
      }
    }
    
    // Revalidate the page
    revalidatePath('/settings/posting-schedule')
    
    return { success: true }
  } catch (error) {
    console.error('Error parsing schedule:', error)
    return { error: 'Invalid schedule data' }
  }
}