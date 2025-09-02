/**
 * Script to delete a test user for testing signup flow
 * Usage: npx tsx scripts/delete-test-user.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function deleteUser(email: string) {
  console.log(`🔍 Looking for user with email: ${email}`);

  try {
    // First, get the user from auth
    const { data: { users }, error: searchError } = await supabase.auth.admin.listUsers();
    
    if (searchError) {
      console.error('❌ Error searching for user:', searchError);
      return;
    }

    const authUser = users.find(u => u.email === email);
    
    if (!authUser) {
      console.log('❌ No user found with that email in auth');
      return;
    }

    console.log(`✅ Found user: ${authUser.id}`);

    // Get user's tenant_id from users table
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', authUser.id)
      .single();

    const tenantId = userData?.tenant_id;

    if (tenantId) {
      console.log(`🏢 User has tenant: ${tenantId}`);

      // Check if user owns the tenant
      const { data: tenant } = await supabase
        .from('tenants')
        .select('created_by')
        .eq('id', tenantId)
        .single();

      if (tenant?.created_by === authUser.id) {
        console.log('👤 User owns the tenant, checking for other members...');
        
        // Check if there are other users in the tenant
        const { data: otherUsers } = await supabase
          .from('users')
          .select('id')
          .eq('tenant_id', tenantId)
          .neq('id', authUser.id);

        if (otherUsers && otherUsers.length > 0) {
          console.log('⚠️  Tenant has other users, only removing this user');
          
          // Just remove this user from tenant
          await supabase
            .from('users')
            .update({ tenant_id: null })
            .eq('id', authUser.id);
        } else {
          console.log('🗑️  User is sole tenant member, deleting entire tenant...');
          
          // Delete tenant data in order
          
          // Delete campaign-related data
          const { data: campaigns } = await supabase
            .from('campaigns')
            .select('id')
            .eq('tenant_id', tenantId);

          if (campaigns && campaigns.length > 0) {
            console.log(`🗑️  Deleting ${campaigns.length} campaigns...`);
            
            for (const campaign of campaigns) {
              await supabase.from('campaign_posts').delete().eq('campaign_id', campaign.id);
            }
            
            await supabase.from('campaigns').delete().eq('tenant_id', tenantId);
          }

          // Delete social connections
          await supabase.from('social_accounts').delete().eq('tenant_id', tenantId);
          await supabase.from('social_connections').delete().eq('tenant_id', tenantId);

          // Delete other tenant data
          await supabase.from('posting_schedules').delete().eq('tenant_id', tenantId);
          await supabase.from('brand_profiles').delete().eq('tenant_id', tenantId);
          await supabase.from('media_assets').delete().eq('tenant_id', tenantId);
          await supabase.from('watermark_settings').delete().eq('tenant_id', tenantId);
          await supabase.from('tenant_logos').delete().eq('tenant_id', tenantId);

          // Finally delete the tenant
          await supabase.from('tenants').delete().eq('id', tenantId);
          console.log('✅ Tenant and all related data deleted');
        }
      }
    }

    // Use the database function to properly delete the user
    console.log('🔧 Using database function to delete user...');
    
    const { data: deleteResult, error: deleteError } = await supabase
      .rpc('delete_user_account', { p_user_id: authUser.id });

    if (deleteError) {
      console.error('❌ Error using database function:', deleteError);
      
      // Try manual deletion as fallback
      console.log('🔧 Attempting manual deletion...');
      
      // First delete from users table (this should cascade delete tenant if user owns it)
      const { error: userDeleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', authUser.id);

      if (userDeleteError) {
        console.error('❌ Error deleting from users table:', userDeleteError);
        return;
      }

      // Then delete from auth
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(authUser.id);

      if (authDeleteError) {
        console.error('❌ Error deleting from auth:', authDeleteError);
        return;
      }
    }

    console.log('✅ User successfully deleted from auth and database');
    console.log('🎉 You can now test the signup flow from scratch');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the deletion
deleteUser('peter@orangejelly.co.uk')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });