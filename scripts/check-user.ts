/**
 * Script to check if a user exists
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

async function checkUser(email: string) {
  console.log(`🔍 Checking for user: ${email}`);

  // Check in auth
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  
  if (error) {
    console.error('❌ Error listing users:', error);
    return;
  }

  const authUser = users.find(u => u.email === email);
  
  if (authUser) {
    console.log(`✅ User exists in auth with ID: ${authUser.id}`);
    console.log('   Created at:', authUser.created_at);
    console.log('   Email confirmed:', authUser.email_confirmed_at ? 'Yes' : 'No');
    
    // Check in users table
    const { data: dbUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();
      
    if (dbUser) {
      console.log('✅ User exists in database');
      console.log('   Tenant ID:', dbUser.tenant_id || 'None');
    } else {
      console.log('⚠️  User NOT in database table');
    }
  } else {
    console.log('❌ No user found with that email');
  }
}

// Check the user
checkUser('peter@orangejelly.co.uk')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });