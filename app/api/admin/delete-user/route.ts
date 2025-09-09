import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    
    // Only allow this in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }
    
    // Use service role to bypass RLS
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    
    // Get user ID
    const { data: authUser } = await supabase.auth.admin.listUsers();
    const user = authUser?.users.find(u => u.email === email);
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    console.log('Found user:', user.id);
    
    // Get tenant ID
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    
    const tenantId = userData?.tenant_id;
    
    if (tenantId) {
      console.log('Found tenant:', tenantId);
      
      // Delete all tenant-related data
      // First delete campaign_posts for campaigns belonging to the tenant
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id')
        .eq('tenant_id', tenantId);
      const campaignIds = (campaigns || []).map(c => c.id);
      if (campaignIds.length) {
        await supabase.from('campaign_posts').delete().in('campaign_id', campaignIds);
      }
      await supabase.from('campaigns').delete().eq('tenant_id', tenantId);
      await supabase.from('brand_profiles').delete().eq('tenant_id', tenantId);
      await supabase.from('brand_voice_profiles').delete().eq('tenant_id', tenantId);
      await supabase.from('social_connections').delete().eq('tenant_id', tenantId);
      await supabase.from('social_accounts').delete().eq('tenant_id', tenantId);
      await supabase.from('media_assets').delete().eq('tenant_id', tenantId);
      await supabase.from('tenant_logos').delete().eq('tenant_id', tenantId);
      await supabase.from('watermark_settings').delete().eq('tenant_id', tenantId);
      await supabase.from('posting_schedules').delete().eq('tenant_id', tenantId);
      await supabase.from('content_guardrails').delete().eq('tenant_id', tenantId);
      await supabase.from('user_tenants').delete().eq('tenant_id', tenantId);
      await supabase.from('tenants').delete().eq('id', tenantId);
    }
    
    // Delete user from users table
    await supabase.from('users').delete().eq('id', user.id);
    
    // Delete user from auth
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    
    if (deleteError) {
      console.error('Error deleting auth user:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `User ${email} and all related data has been deleted` 
    });
    
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
