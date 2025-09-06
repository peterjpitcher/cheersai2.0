const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function upgradeAnchorTenant() {
  try {
    // Get both Anchor tenants with their associated data
    console.log('Fetching Anchor tenants with associated data...');
    
    const { data: tenants, error: fetchError } = await supabase
      .from('tenants')
      .select(`
        id, 
        name, 
        subscription_status, 
        subscription_tier, 
        total_campaigns_created, 
        created_at,
        users (id, email, first_name, last_name),
        campaigns (id, name, created_at),
        social_connections (id, platform, account_name)
      `)
      .ilike('name', '%anchor%')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching tenants:', fetchError);
      return;
    }

    if (!tenants || tenants.length === 0) {
      console.log('No Anchor tenants found');
      return;
    }

    console.log('\nFound tenants:');
    tenants.forEach((tenant, index) => {
      console.log(`\n${index + 1}. Tenant ID: ${tenant.id}`);
      console.log(`   Created: ${tenant.created_at}`);
      console.log(`   Users: ${tenant.users?.length || 0}`);
      console.log(`   Campaigns: ${tenant.campaigns?.length || 0}`);
      console.log(`   Social connections: ${tenant.social_connections?.length || 0}`);
      
      if (tenant.users?.length > 0) {
        console.log(`   User emails: ${tenant.users.map(u => u.email).join(', ')}`);
      }
    });

    // Determine which tenant to keep (the one with more data/activity)
    let keepTenant, deleteTenant;
    
    if (tenants.length === 2) {
      const [tenant1, tenant2] = tenants;
      
      // Score each tenant based on activity
      const score1 = (tenant1.users?.length || 0) * 10 + 
                    (tenant1.campaigns?.length || 0) * 5 + 
                    (tenant1.social_connections?.length || 0) * 3;
      
      const score2 = (tenant2.users?.length || 0) * 10 + 
                    (tenant2.campaigns?.length || 0) * 5 + 
                    (tenant2.social_connections?.length || 0) * 3;

      if (score1 >= score2) {
        keepTenant = tenant1;
        deleteTenant = tenant2;
      } else {
        keepTenant = tenant2;
        deleteTenant = tenant1;
      }

      console.log(`\nDecision: Keeping tenant ${keepTenant.id} (score: ${score1 >= score2 ? score1 : score2})`);
      console.log(`Deleting tenant ${deleteTenant.id} (score: ${score1 >= score2 ? score2 : score1})`);

      // Delete the unused tenant (cascade will handle related records)
      console.log(`\nDeleting unused tenant ${deleteTenant.id}...`);
      const { error: deleteError } = await supabase
        .from('tenants')
        .delete()
        .eq('id', deleteTenant.id);

      if (deleteError) {
        console.error('Error deleting tenant:', deleteError);
        return;
      }

      console.log('✅ Unused tenant deleted successfully');
    } else {
      keepTenant = tenants[0];
      console.log(`\nOnly one tenant found, keeping: ${keepTenant.id}`);
    }

    // Upgrade the remaining tenant to professional
    console.log(`\nUpgrading tenant ${keepTenant.id} to professional...`);
    
    const { error: upgradeError } = await supabase
      .from('tenants')
      .update({
        subscription_tier: 'professional',
        subscription_status: 'active',
        trial_ends_at: null, // No trial end date
        total_campaigns_created: 0 // Reset for clean slate
      })
      .eq('id', keepTenant.id);

    if (upgradeError) {
      console.error('Error upgrading tenant:', upgradeError);
      return;
    }

    console.log('✅ Tenant upgraded to professional successfully');

    // Verify the final state
    const { data: finalTenant, error: verifyError } = await supabase
      .from('tenants')
      .select('id, name, subscription_status, subscription_tier, trial_ends_at, total_campaigns_created')
      .eq('id', keepTenant.id)
      .single();

    if (verifyError) {
      console.error('Error verifying upgrade:', verifyError);
    } else {
      console.log('\nFinal tenant state:');
      console.log(`  ID: ${finalTenant.id}`);
      console.log(`  Name: ${finalTenant.name}`);
      console.log(`  Tier: ${finalTenant.subscription_tier}`);
      console.log(`  Status: ${finalTenant.subscription_status}`);
      console.log(`  Trial ends: ${finalTenant.trial_ends_at || 'Never'}`);
      console.log(`  Campaign count: ${finalTenant.total_campaigns_created}`);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  } finally {
    process.exit(0);
  }
}

upgradeAnchorTenant();