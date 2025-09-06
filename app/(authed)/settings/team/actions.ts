'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function inviteTeamMember(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const tenantId = formData.get('tenant_id') as string
  const email = formData.get('email') as string
  const role = formData.get('role') as string
  
  if (!tenantId || !email || !role) {
    return { error: 'Missing required fields' }
  }
  
  // Verify user has permission to invite
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  
  if (userError || userData?.tenant_id !== tenantId) {
    return { error: 'Unauthorised' }
  }
  
  if (userData.role !== 'owner' && userData.role !== 'admin') {
    return { error: 'Only owners and admins can invite team members' }
  }
  
  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .eq('tenant_id', tenantId)
      .single()
    
    if (existingUser) {
      return { error: 'This user is already a member of your team' }
    }
    
    // Generate invitation token
    const token = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry
    
    // Create invitation
    const { error: inviteError } = await supabase
      .from('team_invitations')
      .insert({
        tenant_id: tenantId,
        email,
        role,
        token,
        invited_by: user.id,
        expires_at: expiresAt.toISOString(),
        accepted: false
      })
    
    if (inviteError) {
      console.error('Error creating invitation:', inviteError)
      return { error: 'Failed to create invitation' }
    }
    
    // Get tenant name for email
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single()
    
    // Send invitation email
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/accept-invite?token=${token}`
    
    const { error: emailError } = await resend.emails.send({
      from: 'CheersAI <noreply@cheersai.com>',
      to: email,
      subject: `You've been invited to join ${tenantData?.name || 'a team'} on CheersAI`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #111827; font-size: 24px; margin-bottom: 16px;">You've been invited to CheersAI</h1>
          
          <p style="color: #4B5563; font-size: 16px; line-height: 24px; margin-bottom: 24px;">
            ${userData.first_name || user.email} has invited you to join <strong>${tenantData?.name || 'their team'}</strong> on CheersAI as a ${role}.
          </p>
          
          <p style="color: #4B5563; font-size: 16px; line-height: 24px; margin-bottom: 24px;">
            CheersAI is an AI-powered social media management platform designed specifically for UK hospitality businesses.
          </p>
          
          <a href="${inviteUrl}" style="display: inline-block; background-color: #EA580C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Accept Invitation
          </a>
          
          <p style="color: #6B7280; font-size: 14px; margin-top: 32px;">
            This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
          </p>
        </div>
      `
    })
    
    if (emailError) {
      console.error('Error sending invitation email:', emailError)
      // Don't fail the whole operation if email fails
    }
    
    // Revalidate the page
    revalidatePath('/settings/team')
    
    return { success: true }
  } catch (error) {
    console.error('Error inviting team member:', error)
    return { error: 'Failed to send invitation' }
  }
}

export async function updateTeamMember(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const tenantId = formData.get('tenant_id') as string
  const memberId = formData.get('member_id') as string
  const newRole = formData.get('role') as string
  
  if (!tenantId || !memberId || !newRole) {
    return { error: 'Missing required fields' }
  }
  
  // Verify user has permission
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  
  if (userError || userData?.tenant_id !== tenantId) {
    return { error: 'Unauthorised' }
  }
  
  if (userData.role !== 'owner' && userData.role !== 'admin') {
    return { error: 'Only owners and admins can manage team members' }
  }
  
  // Don't allow changing owner role
  const { data: targetUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', memberId)
    .single()
  
  if (targetUser?.role === 'owner') {
    return { error: 'Cannot change the owner role' }
  }
  
  // Update the member's role
  const { error: updateError } = await supabase
    .from('users')
    .update({ role: newRole })
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
  
  if (updateError) {
    console.error('Error updating team member:', updateError)
    return { error: 'Failed to update team member' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/team')
  
  return { success: true }
}

export async function removeTeamMember(formData: FormData) {
  const supabase = await createClient()
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }
  
  // Get form data
  const tenantId = formData.get('tenant_id') as string
  const memberId = formData.get('member_id') as string
  
  if (!tenantId || !memberId) {
    return { error: 'Missing required fields' }
  }
  
  // Verify user has permission
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  
  if (userError || userData?.tenant_id !== tenantId) {
    return { error: 'Unauthorised' }
  }
  
  if (userData.role !== 'owner' && userData.role !== 'admin') {
    return { error: 'Only owners and admins can remove team members' }
  }
  
  // Don't allow removing the owner
  const { data: targetUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', memberId)
    .single()
  
  if (targetUser?.role === 'owner') {
    return { error: 'Cannot remove the owner' }
  }
  
  // Remove the user's tenant association
  const { error: updateError } = await supabase
    .from('users')
    .update({ tenant_id: null })
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
  
  if (updateError) {
    console.error('Error removing team member:', updateError)
    return { error: 'Failed to remove team member' }
  }
  
  // Revalidate the page
  revalidatePath('/settings/team')
  
  return { success: true }
}
