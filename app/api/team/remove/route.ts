import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';

export async function DELETE(request: NextRequest) {
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { memberId } = await request.json();

    if (!memberId) {
      return NextResponse.json(
        { error: 'Member ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Check if user has permission to remove members
    const { data: remover } = await supabase
      .from('team_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .single();

    if (!remover || !['owner', 'admin'].includes(remover.role)) {
      return NextResponse.json(
        { error: 'You do not have permission to remove team members' },
        { status: 403 }
      );
    }

    // Check the member to be removed
    const { data: memberToRemove } = await supabase
      .from('team_members')
      .select('role, user_id')
      .eq('id', memberId)
      .eq('tenant_id', tenantId)
      .single();

    if (!memberToRemove) {
      return NextResponse.json(
        { error: 'Team member not found' },
        { status: 404 }
      );
    }

    // Prevent removing owner
    if (memberToRemove.role === 'owner') {
      return NextResponse.json(
        { error: 'Cannot remove the team owner' },
        { status: 403 }
      );
    }

    // Prevent admin from removing another admin (only owner can)
    if (remover.role === 'admin' && memberToRemove.role === 'admin') {
      return NextResponse.json(
        { error: 'Only the owner can remove other admins' },
        { status: 403 }
      );
    }

    // Remove the team member
    const { error: deleteError } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId)
      .eq('tenant_id', tenantId);

    if (deleteError) {
      console.error('Error removing team member:', deleteError);
      return NextResponse.json(
        { error: 'Failed to remove team member' },
        { status: 500 }
      );
    }

    // If member has a user_id, also revoke their access to tenant resources
    if (memberToRemove.user_id) {
      // Update any active sessions or permissions
      await supabase
        .from('user_tenants')
        .delete()
        .eq('user_id', memberToRemove.user_id)
        .eq('tenant_id', tenantId);
    }

    return NextResponse.json({
      success: true,
      message: 'Team member removed successfully',
    });
  } catch (error) {
    console.error('Error removing team member:', error);
    return NextResponse.json(
      { error: 'Failed to remove team member' },
      { status: 500 }
    );
  }
}