#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyDatabase() {
  console.log('🔍 Verifying PubHubAI Database Setup...\n');

  const requiredTables = [
    'tenants',
    'users',
    'brand_profiles',
    'media_assets',
    'campaigns',
    'campaign_posts',
    'user_engagement',
    'social_connections',
    'publishing_history',
    'publishing_queue'
  ];

  let allTablesExist = true;
  const missingTables: string[] = [];

  // Check each table
  for (const table of requiredTables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error && error.code === '42P01') {
        console.log(`❌ Table '${table}' does not exist`);
        missingTables.push(table);
        allTablesExist = false;
      } else if (error) {
        console.log(`⚠️  Table '${table}' exists but has errors: ${error.message}`);
      } else {
        console.log(`✅ Table '${table}' exists (${count || 0} rows)`);
      }
    } catch (err) {
      console.log(`❌ Error checking table '${table}':`, err);
      allTablesExist = false;
    }
  }

  console.log('\n' + '='.repeat(50));

  if (allTablesExist) {
    console.log('✅ All required tables exist!');
    console.log('\n📋 Next steps:');
    console.log('1. Create storage bucket "media" in Supabase Dashboard');
    console.log('2. Configure authentication redirect URLs');
    console.log('3. Test signup flow at http://localhost:3000');
  } else {
    console.log('❌ Database setup incomplete!');
    console.log(`\n Missing tables: ${missingTables.join(', ')}`);
    console.log('\n📋 To fix:');
    console.log('1. Go to Supabase Dashboard → SQL Editor');
    console.log('2. Copy the entire script from DATABASE_SETUP.md');
    console.log('3. Paste and run in SQL Editor');
    console.log('4. Run this script again to verify');
  }

  // Check storage buckets
  console.log('\n🗂️  Checking storage buckets...');
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  
  if (bucketsError) {
    console.log('⚠️  Could not check storage buckets:', bucketsError.message);
  } else {
    const mediaBucket = buckets?.find(b => b.name === 'media');
    if (mediaBucket) {
      console.log('✅ Storage bucket "media" exists');
    } else {
      console.log('❌ Storage bucket "media" not found');
      console.log('   Create it in Supabase Dashboard → Storage');
    }
  }
}

// Run verification
verifyDatabase().catch(console.error);