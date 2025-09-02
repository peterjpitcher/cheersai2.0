/**
 * Force delete a user from Supabase Auth
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

async function forceDeleteUser(email: string) {
  console.log(`🔍 Looking for user: ${email}`);

  // Find user in auth
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error('❌ Error listing users:', listError);
    return;
  }

  const authUser = users.find(u => u.email === email);
  
  if (!authUser) {
    console.log('❌ No user found with that email');
    return;
  }

  console.log(`✅ Found user: ${authUser.id}`);
  console.log('🗑️  Attempting to delete from auth...');

  // Delete from auth using admin API
  const { error: deleteError } = await supabase.auth.admin.deleteUser(
    authUser.id,
    true // shouldSoftDelete = true to bypass foreign key constraints
  );

  if (deleteError) {
    console.error('❌ Error deleting user:', deleteError);
    console.log('\n💡 Trying alternative method...');
    
    // Try with fetch API directly
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${authUser.id}`, {
      method: 'DELETE',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Direct API delete failed:', errorText);
      
      console.log('\n⚠️  The user may have foreign key constraints.');
      console.log('Try deleting from Supabase Dashboard:');
      console.log('1. Go to Authentication → Users');
      console.log('2. Find peter@orangejelly.co.uk');
      console.log('3. Click the three dots menu');
      console.log('4. Select "Delete user"');
      return;
    }
    
    console.log('✅ User deleted via direct API');
  } else {
    console.log('✅ User successfully deleted from auth');
  }

  console.log('🎉 You can now test the signup flow from scratch');
}

// Delete the user
forceDeleteUser('peter@orangejelly.co.uk')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });