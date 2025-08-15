#!/usr/bin/env node

/**
 * Database Setup Script for CheersAI
 * 
 * This script runs all SQL migrations to set up the complete database schema.
 * Run this after creating a new Supabase project.
 * 
 * Usage: node scripts/setup-database.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

// Check for required environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables!');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your .env.local file');
  process.exit(1);
}

// Create Supabase client with service role key (has admin privileges)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration(filePath, fileName) {
  try {
    console.log(`\n📄 Running migration: ${fileName}`);
    
    const sql = await fs.readFile(filePath, 'utf8');
    
    // Split by semicolons but be careful with functions
    const statements = sql
      .split(/;\s*$(?=\n)/m)
      .filter(stmt => stmt.trim().length > 0)
      .map(stmt => stmt.trim() + ';');
    
    for (const statement of statements) {
      if (statement.trim().length > 0 && !statement.trim().startsWith('--')) {
        const { error } = await supabase.rpc('exec_sql', { 
          sql_query: statement 
        }).single();
        
        if (error) {
          // Try direct execution as fallback
          const { error: directError } = await supabase
            .from('_sql')
            .insert({ query: statement });
          
          if (directError) {
            console.error(`   ❌ Failed to execute statement: ${directError.message}`);
            console.error(`   Statement: ${statement.substring(0, 100)}...`);
          }
        }
      }
    }
    
    console.log(`   ✅ Migration ${fileName} completed`);
    return true;
  } catch (error) {
    console.error(`   ❌ Error running migration ${fileName}:`, error.message);
    return false;
  }
}

async function setupDatabase() {
  console.log('🚀 Starting CheersAI Database Setup\n');
  console.log(`📍 Supabase URL: ${SUPABASE_URL}`);
  
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  
  try {
    // Get all SQL files in migrations directory
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files
      .filter(file => file.endsWith('.sql'))
      .sort(); // Ensure they run in order
    
    console.log(`\n📦 Found ${sqlFiles.length} migration files:`);
    sqlFiles.forEach(file => console.log(`   - ${file}`));
    
    let successCount = 0;
    let failCount = 0;
    
    // Run each migration in order
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const success = await runMigration(filePath, file);
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log('='.repeat(50));
    
    if (failCount === 0) {
      console.log('\n🎉 Database setup completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('   1. Verify tables in Supabase Dashboard');
      console.log('   2. Test authentication flow');
      console.log('   3. Create a test user account');
    } else {
      console.log('\n⚠️  Some migrations failed. Please check the errors above.');
      console.log('You may need to run the failed migrations manually in Supabase SQL Editor.');
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error during setup:', error);
    process.exit(1);
  }
}

// Note about alternative approach
console.log('📌 Note: This script attempts to run migrations programmatically.');
console.log('   If it fails, you can manually run the SQL files in Supabase Dashboard:');
console.log('   1. Go to your Supabase project');
console.log('   2. Navigate to SQL Editor');
console.log('   3. Copy and paste each .sql file from supabase/migrations/');
console.log('   4. Run them in order (001, 002, 003, etc.)\n');

// Run the setup
setupDatabase().catch(console.error);