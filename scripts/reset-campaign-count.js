const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetCampaignCount() {
  try {
    // First, check current status of The Anchor tenant
    console.log('Checking current status of The Anchor tenant...');
    const { data: tenants, error: fetchError } = await supabase
      .from('tenants')
      .select('id, name, subscription_status, subscription_tier, total_campaigns_created, created_at')
      .ilike('name', '%anchor%');

    if (fetchError) {
      console.error('Error fetching tenant:', fetchError);
      return;
    }

    if (!tenants || tenants.length === 0) {
      console.log('No tenant found with name containing "anchor"');
      return;
    }

    console.log('Found tenant(s):', tenants);

    // Check actual campaign count
    for (const tenant of tenants) {
      const { data: campaigns, error: countError } = await supabase
        .from('campaigns')
        .select('id')
        .eq('tenant_id', tenant.id);

      if (countError) {
        console.error('Error counting campaigns:', countError);
        continue;
      }

      console.log(`\nTenant: ${tenant.name}`);
      console.log(`  Stored count: ${tenant.total_campaigns_created || 0}`);
      console.log(`  Actual count: ${campaigns ? campaigns.length : 0}`);

      // Reset the campaign count to 0 for testing
      console.log(`\nResetting campaign count to 0 for tenant: ${tenant.name}`);
      const { error: updateError } = await supabase
        .from('tenants')
        .update({ total_campaigns_created: 0 })
        .eq('id', tenant.id);

      if (updateError) {
        console.error('Error updating campaign count:', updateError);
      } else {
        console.log('✅ Campaign count reset successfully!');
        
        // Verify the update
        const { data: updatedTenant, error: verifyError } = await supabase
          .from('tenants')
          .select('id, name, total_campaigns_created')
          .eq('id', tenant.id)
          .single();

        if (verifyError) {
          console.error('Error verifying update:', verifyError);
        } else {
          console.log('Verified new count:', updatedTenant.total_campaigns_created);
        }
      }
    }
  } catch (error) {
    console.error('Unexpected error:', error);
  } finally {
    process.exit(0);
  }
}

resetCampaignCount();