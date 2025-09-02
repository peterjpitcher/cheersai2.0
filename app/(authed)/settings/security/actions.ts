'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updatePassword(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const currentPassword = formData.get('current_password') as string
  const newPassword = formData.get('new_password') as string
  const confirmPassword = formData.get('confirm_password') as string
  
  // Validate inputs
  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: 'All fields are required' }
  }
  
  if (newPassword !== confirmPassword) {
    return { error: 'New passwords do not match' }
  }
  
  if (newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters long' }
  }
  
  // Verify current password by attempting to sign in
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword
  })
  
  if (signInError) {
    return { error: 'Current password is incorrect' }
  }
  
  // Update password
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword
  })
  
  if (updateError) {
    console.error('Error updating password:', updateError)
    return { error: 'Failed to update password' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/security')
  
  return { success: true }
}