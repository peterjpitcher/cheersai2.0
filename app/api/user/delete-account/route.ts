import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * DELETE /api/user/delete-account
 * 
 * Completely deletes a user account and all associated data.
 * This is a destructive operation that cannot be undone.
 * 
 * Process:
 * 1. Verify user authentication
 * 2. Check if user is sole tenant owner
 * 3. Delete storage files
 * 4. Delete tenant data (if sole owner)
 * 5. Clean orphaned references
 * 6. Delete user record
 * 7. Delete from auth.users
 */
export async function DELETE(request: Request) {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = user.id
    console.log(`Starting account deletion for user: ${userId}`)

    // Create admin client for full deletion capabilities
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Step 1: Get user's tenant information
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('tenant_id, email, first_name, last_name')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      console.error('User not found in users table:', userError)
      return NextResponse.json(
        { error: 'User data not found' },
        { status: 404 }
      )
    }

    const tenantId = userData.tenant_id

    // Step 2: Check if user is sole tenant owner
    let deleteTenant = false
    if (tenantId) {
      const { data: tenantData } = await adminClient
        .from('tenants')
        .select('owner_id')
        .eq('id', tenantId)
        .single()

      if (tenantData?.owner_id === userId) {
        // Check if there are other users in this tenant
        const { count } = await adminClient
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .neq('id', userId)

        if (count === 0) {
          deleteTenant = true
          console.log('User is sole tenant owner, will delete tenant')
        } else {
          console.log(`Tenant has ${count} other users, will not delete tenant`)
        }
      }
    }

    // Step 3: Delete storage files if tenant will be deleted
    if (deleteTenant && tenantId) {
      console.log('Deleting storage files for tenant:', tenantId)
      
      // List all files in tenant's folder
      const { data: files, error: listError } = await adminClient
        .storage
        .from('media')
        .list(tenantId)

      if (!listError && files && files.length > 0) {
        // Delete all files
        const filePaths = files.map(file => `${tenantId}/${file.name}`)
        const { error: deleteError } = await adminClient
          .storage
          .from('media')
          .remove(filePaths)

        if (deleteError) {
          console.error('Error deleting storage files:', deleteError)
        } else {
          console.log(`Deleted ${filePaths.length} storage files`)
        }
      }
    }

    // Step 4: Clean up orphaned references
    console.log('Cleaning orphaned references')
    
    // Set user references to NULL in tables that preserve history
    const orphanedTables = [
      { table: 'team_invitations', column: 'invited_by' },
      { table: 'content_guardrails', column: 'user_id' },
      { table: 'content_guardrails_history', column: 'user_id' },
      { table: 'ai_generation_feedback', column: 'user_id' },
      { table: 'campaign_posts', column: 'approved_by' },
      { table: 'audit_logs', column: 'user_id' }
    ]

    for (const { table, column } of orphanedTables) {
      const { error } = await adminClient
        .from(table)
        .update({ [column]: null })
        .eq(column, userId)

      if (error) {
        console.error(`Error cleaning ${table}.${column}:`, error)
      }
    }

    // Step 5: Delete tenant if user is sole owner
    if (deleteTenant && tenantId) {
      console.log('Deleting tenant and all associated data')
      
      // The tenant deletion will cascade to all tenant-scoped tables
      const { error: tenantError } = await adminClient
        .from('tenants')
        .delete()
        .eq('id', tenantId)

      if (tenantError) {
        console.error('Error deleting tenant:', tenantError)
        return NextResponse.json(
          { error: 'Failed to delete tenant data' },
          { status: 500 }
        )
      }
    } else if (tenantId) {
      // Just remove user from tenant
      console.log('Removing user from tenant')
      
      // Delete user-specific data that won't cascade
      const userSpecificTables = [
        'notification_settings',
        'performance_metrics',
        'error_logs',
        'support_tickets'
      ]

      for (const table of userSpecificTables) {
        const { error } = await adminClient
          .from(table)
          .delete()
          .eq('user_id', userId)

        if (error) {
          console.error(`Error deleting from ${table}:`, error)
        }
      }
    }

    // Step 6: Delete from users table (will cascade to remaining user-specific tables)
    console.log('Deleting user record')
    const { error: deleteUserError } = await adminClient
      .from('users')
      .delete()
      .eq('id', userId)

    if (deleteUserError) {
      console.error('Error deleting user record:', deleteUserError)
      return NextResponse.json(
        { error: 'Failed to delete user record' },
        { status: 500 }
      )
    }

    // Step 7: Delete from auth.users (Supabase Auth)
    console.log('Deleting from auth.users')
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId)

    if (authDeleteError) {
      console.error('Error deleting from auth.users:', authDeleteError)
      // Don't fail the whole operation if auth deletion fails
      // The user data is already deleted
    }

    // Step 8: Log the deletion for audit purposes
    await adminClient
      .from('audit_logs')
      .insert({
        event: 'user.deleted',
        user_id: null, // User is deleted, so set to null
        metadata: {
          deleted_user_id: userId,
          deleted_user_email: userData.email,
          deleted_user_name: `${userData.first_name} ${userData.last_name}`,
          tenant_deleted: deleteTenant,
          tenant_id: tenantId,
          timestamp: new Date().toISOString()
        }
      })

    console.log('Account deletion completed successfully')

    // Sign out the user on the client side will happen automatically
    // since their session is now invalid
    
    return NextResponse.json({
      success: true,
      message: 'Account successfully deleted',
      details: {
        userId,
        tenantDeleted: deleteTenant,
        tenantId
      }
    })

  } catch (error) {
    console.error('Unexpected error during account deletion:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred during account deletion' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/user/delete-account
 * 
 * Soft delete - marks account as deleted but preserves data for 30 days
 * (Optional implementation for GDPR compliance)
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Implement soft delete by adding deleted_at timestamp
    const { error } = await supabase
      .from('users')
      .update({ 
        deleted_at: new Date().toISOString(),
        email: `deleted_${user.id}@deleted.local`, // Anonymize email
        first_name: 'Deleted',
        last_name: 'User'
      })
      .eq('id', user.id)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to mark account as deleted' },
        { status: 500 }
      )
    }

    // Sign out the user
    await supabase.auth.signOut()

    return NextResponse.json({
      success: true,
      message: 'Account marked for deletion. Will be permanently deleted in 30 days.'
    })

  } catch (error) {
    console.error('Error in soft delete:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}