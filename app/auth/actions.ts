'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function signOut() {
  const supabase = await createClient()
  
  const { error } = await supabase.auth.signOut()
  
  if (error) {
    console.error('Error signing out:', error)
  }
  
  // Revalidate all paths to ensure fresh data
  revalidatePath('/', 'layout')
  
  // Redirect to home page
  redirect('/')
}

export async function signInWithPassword(email: string, password: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  
  if (error) {
    return { error: error.message }
  }
  
  // Revalidate paths to ensure fresh data
  revalidatePath('/', 'layout')
  
  return { success: true }
}

export async function signUp(email: string, password: string) {
  const enabled = process.env.SIGNUPS_ENABLED === 'true' || process.env.NEXT_PUBLIC_SIGNUPS_ENABLED === 'true'
  if (!enabled) {
    return { error: 'Signups are currently disabled' }
  }
  const supabase = await createClient()
  
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  })
  
  if (error) {
    return { error: error.message }
  }
  
  return { success: true }
}

export async function signInWithOtp(email: string) {
  const supabase = await createClient()
  
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  })
  
  if (error) {
    return { error: error.message }
  }
  
  return { success: true }
}

export async function resetPassword(email: string) {
  const supabase = await createClient()
  
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
  })
  
  if (error) {
    return { error: error.message }
  }
  
  return { success: true }
}

export async function updatePassword(newPassword: string) {
  const supabase = await createClient()
  
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  })
  
  if (error) {
    return { error: error.message }
  }
  
  // Revalidate paths
  revalidatePath('/', 'layout')
  
  return { success: true }
}
