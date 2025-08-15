import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { sendEmail } from '@/lib/email/resend';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { email, role } = await request.json();

    if (!email || !role) {
      return NextResponse.json(
        { error: 'Email and role are required' },
        { status: 400 }
      );
    }

    // Validate role
    if (!['admin', 'editor', 'viewer'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Check if user has permission to invite
    const { data: inviter } = await supabase
      .from('team_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .single();

    if (!inviter || !['owner', 'admin'].includes(inviter.role)) {
      return NextResponse.json(
        { error: 'You do not have permission to invite team members' },
        { status: 403 }
      );
    }

    // Check if member already exists
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .single();

    if (existingMember) {
      return NextResponse.json(
        { error: 'This email is already a team member' },
        { status: 400 }
      );
    }

    // Generate invitation token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Create invitation record
    const { data: invitation, error: inviteError } = await supabase
      .from('team_invitations')
      .insert({
        tenant_id: tenantId,
        email,
        role,
        invited_by: user.id,
        token: inviteToken,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
      })
      .select()
      .single();

    if (inviteError) {
      console.error('Error creating invitation:', inviteError);
      return NextResponse.json(
        { error: 'Failed to create invitation' },
        { status: 500 }
      );
    }

    // Get tenant name for email
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();

    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/team/invite?token=${inviteToken}`;

    // Send invitation email
    await sendEmail({
      to: email,
      subject: `You've been invited to join ${tenant?.name || 'a team'} on CheersAI`,
      template: 'teamInvite',
      data: {
        teamName: tenant?.name || 'the team',
        inviterEmail: user.email,
        role,
        inviteLink,
        expiresAt: expiresAt.toLocaleDateString(),
      },
    });

    // Also create a pending team member record
    await supabase.from('team_members').insert({
      tenant_id: tenantId,
      email,
      role,
      status: 'invited',
      invited_at: new Date().toISOString(),
      invitation_id: invitation.id,
    });

    return NextResponse.json({
      success: true,
      inviteLink,
      message: 'Invitation sent successfully',
    });
  } catch (error) {
    console.error('Error inviting team member:', error);
    return NextResponse.json(
      { error: 'Failed to send invitation' },
      { status: 500 }
    );
  }
}