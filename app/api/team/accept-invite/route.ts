import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/resend';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'Invitation token is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Verify invitation token
    const { data: invitation, error: inviteError } = await supabase
      .from('team_invitations')
      .select('*, tenants(name)')
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (inviteError || !invitation) {
      return NextResponse.json(
        { error: 'Invalid or expired invitation' },
        { status: 400 }
      );
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      await supabase
        .from('team_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);

      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 400 }
      );
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      // User needs to sign up or log in first
      return NextResponse.json(
        { error: 'Please sign up or log in to accept this invitation' },
        { status: 401 }
      );
    }

    // Check if user email matches invitation
    if (user.email !== invitation.email) {
      return NextResponse.json(
        { error: 'This invitation was sent to a different email address' },
        { status: 403 }
      );
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('tenant_id', invitation.tenant_id)
      .eq('user_id', user.id)
      .single();

    if (existingMember) {
      return NextResponse.json(
        { error: 'You are already a member of this team' },
        { status: 400 }
      );
    }

    // Accept the invitation
    const { error: updateError } = await supabase
      .from('team_invitations')
      .update({ 
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation:', updateError);
      return NextResponse.json(
        { error: 'Failed to accept invitation' },
        { status: 500 }
      );
    }

    // Update or create team member record
    const { error: memberError } = await supabase
      .from('team_members')
      .upsert({
        tenant_id: invitation.tenant_id,
        user_id: user.id,
        email: user.email,
        role: invitation.role,
        status: 'active',
        joined_at: new Date().toISOString(),
        invitation_id: invitation.id,
      }, {
        onConflict: 'tenant_id,email',
      });

    if (memberError) {
      console.error('Error creating team member:', memberError);
      return NextResponse.json(
        { error: 'Failed to add you to the team' },
        { status: 500 }
      );
    }

    // Create user-tenant relationship
    await supabase.from('user_tenants').upsert({
      user_id: user.id,
      tenant_id: invitation.tenant_id,
      role: invitation.role,
    }, {
      onConflict: 'user_id,tenant_id',
    });

    // Get inviter details for notification
    const { data: inviter } = await supabase
      .from('users')
      .select('email')
      .eq('id', invitation.invited_by)
      .single();

    // Send notification to inviter
    if (inviter) {
      await sendEmail({
        to: inviter.email,
        subject: `${user.email} has joined your team`,
        template: 'teamMemberJoined',
        data: {
          teamName: invitation.tenants.name,
          memberEmail: user.email,
          role: invitation.role,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully joined the team',
      teamName: invitation.tenants.name,
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return NextResponse.json(
      { error: 'Failed to accept invitation' },
      { status: 500 }
    );
  }
}