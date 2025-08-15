import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';

export async function PUT(request: NextRequest) {
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { memberId, role } = await request.json();

    if (!memberId || !role) {
      return NextResponse.json(
        { error: 'Member ID and role are required' },
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

    // Check if user has permission to update roles
    const { data: updater } = await supabase
      .from('team_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .single();

    if (!updater || !['owner', 'admin'].includes(updater.role)) {
      return NextResponse.json(
        { error: 'You do not have permission to update team member roles' },
        { status: 403 }
      );
    }

    // Check the member to be updated
    const { data: memberToUpdate } = await supabase
      .from('team_members')
      .select('role')
      .eq('id', memberId)
      .eq('tenant_id', tenantId)
      .single();

    if (!memberToUpdate) {
      return NextResponse.json(
        { error: 'Team member not found' },
        { status: 404 }
      );
    }

    // Prevent changing owner role
    if (memberToUpdate.role === 'owner') {
      return NextResponse.json(
        { error: 'Cannot change the owner role' },
        { status: 403 }
      );
    }

    // Prevent admin from changing another admin's role (only owner can)
    if (updater.role === 'admin' && memberToUpdate.role === 'admin') {
      return NextResponse.json(
        { error: 'Only the owner can change admin roles' },
        { status: 403 }
      );
    }

    // Prevent admin from promoting someone to admin (only owner can)
    if (updater.role === 'admin' && role === 'admin') {
      return NextResponse.json(
        { error: 'Only the owner can promote members to admin' },
        { status: 403 }
      );
    }

    // Update the role
    const { error: updateError } = await supabase
      .from('team_members')
      .update({ 
        role,
        updated_at: new Date().toISOString()
      })
      .eq('id', memberId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('Error updating team member role:', updateError);
      return NextResponse.json(
        { error: 'Failed to update team member role' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Role updated successfully',
    });
  } catch (error) {
    console.error('Error updating team member role:', error);
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    );
  }
}