import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createRequestLogger, logger } from '@/lib/observability/logger'

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
export const runtime = 'nodejs'

export async function DELETE(request: Request) {
  const reqLogger = createRequestLogger(request)
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
    reqLogger.info('Starting account deletion', {
      area: 'account',
      op: 'user.delete',
      status: 'pending',
      userId,
    })

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
      reqLogger.error('User not found in users table', {
        area: 'account',
        op: 'user.delete.lookup',
        status: 'fail',
        userId,
        error: userError ?? undefined,
      })
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
          reqLogger.info('User is sole tenant owner; scheduling tenant deletion', {
            area: 'account',
            op: 'user.delete.tenant-check',
            status: 'ok',
            userId,
            tenantId,
          })
        } else {
          reqLogger.info('Tenant has additional members; skipping tenant deletion', {
            area: 'account',
            op: 'user.delete.tenant-check',
            status: 'ok',
            userId,
            tenantId,
            meta: { remainingUsers: count },
          })
        }
      }
    }

    // Step 3: Delete storage files if tenant will be deleted
    if (deleteTenant && tenantId) {
      reqLogger.info('Deleting tenant storage files', {
        area: 'account',
        op: 'user.delete.storage',
        status: 'pending',
        userId,
        tenantId,
      })
      
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
          reqLogger.error('Failed to delete storage files', {
            area: 'account',
            op: 'user.delete.storage',
            status: 'fail',
            userId,
            tenantId,
            error: deleteError,
          })
        } else {
          reqLogger.info('Deleted tenant storage files', {
            area: 'account',
            op: 'user.delete.storage',
            status: 'ok',
            userId,
            tenantId,
            meta: { count: filePaths.length },
          })
        }
      }
    }

    // Step 4: Clean up orphaned references
    reqLogger.info('Cleaning orphaned references', {
      area: 'account',
      op: 'user.delete.cleanup',
      status: 'pending',
      userId,
    })
    
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
        reqLogger.error('Failed to clean orphaned reference', {
          area: 'account',
          op: 'user.delete.cleanup',
          status: 'fail',
          userId,
          meta: { table, column },
          error,
        })
      }
    }

    // Step 5: Delete tenant if user is sole owner
    if (deleteTenant && tenantId) {
      reqLogger.info('Deleting tenant and associated data', {
        area: 'account',
        op: 'user.delete.tenant',
        status: 'pending',
        userId,
        tenantId,
      })
      
      // The tenant deletion will cascade to all tenant-scoped tables
      const { error: tenantError } = await adminClient
        .from('tenants')
        .delete()
        .eq('id', tenantId)

      if (tenantError) {
        reqLogger.error('Failed to delete tenant', {
          area: 'account',
          op: 'user.delete.tenant',
          status: 'fail',
          userId,
          tenantId,
          error: tenantError,
        })
        return NextResponse.json(
          { error: 'Failed to delete tenant data' },
          { status: 500 }
        )
      }
    } else if (tenantId) {
      // Just remove user from tenant
      reqLogger.info('Removing user from tenant', {
        area: 'account',
        op: 'user.delete.member-removal',
        status: 'pending',
        userId,
        tenantId,
      })
      
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
          reqLogger.error('Failed to delete user-specific table data', {
            area: 'account',
            op: 'user.delete.member-removal',
            status: 'fail',
            userId,
            tenantId,
            meta: { table },
            error,
          })
        }
      }
    }

    // Step 6: Delete from users table (will cascade to remaining user-specific tables)
    reqLogger.info('Deleting user record', {
      area: 'account',
      op: 'user.delete.record',
      status: 'pending',
      userId,
    })
    const { error: deleteUserError } = await adminClient
      .from('users')
      .delete()
      .eq('id', userId)

    if (deleteUserError) {
      reqLogger.error('Failed to delete user record', {
        area: 'account',
        op: 'user.delete.record',
        status: 'fail',
        userId,
        error: deleteUserError,
      })
      return NextResponse.json(
        { error: 'Failed to delete user record' },
        { status: 500 }
      )
    }

    // Step 7: Delete from auth.users (Supabase Auth)
    reqLogger.info('Deleting user from Supabase auth', {
      area: 'account',
      op: 'user.delete.auth-record',
      status: 'pending',
      userId,
    })
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId)

    if (authDeleteError) {
      reqLogger.warn('Failed to delete Supabase auth user', {
        area: 'account',
        op: 'user.delete.auth-record',
        status: 'warn',
        userId,
        error: authDeleteError,
      })
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

    reqLogger.info('Account deletion completed successfully', {
      area: 'account',
      op: 'user.delete',
      status: 'ok',
      userId,
      tenantId,
      meta: { tenantDeleted: deleteTenant },
    })

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
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Unexpected error during account deletion', {
      area: 'account',
      op: 'user.delete',
      status: 'fail',
      error: err,
    })
    logger.error('Account deletion failed', {
      area: 'account',
      op: 'user.delete',
      status: 'fail',
      error: err,
    })
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
  const reqLogger = createRequestLogger(request)
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
      reqLogger.error('Failed to mark account as deleted', {
        area: 'account',
        op: 'user.soft-delete',
        status: 'fail',
        userId: user.id,
        error,
      })
      return NextResponse.json(
        { error: 'Failed to mark account as deleted' },
        { status: 500 }
      )
    }

    // Sign out the user
    await supabase.auth.signOut()

    reqLogger.info('Account marked for deletion', {
      area: 'account',
      op: 'user.soft-delete',
      status: 'ok',
      userId: user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Account marked for deletion. Will be permanently deleted in 30 days.'
    })

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error in soft delete', {
      area: 'account',
      op: 'user.soft-delete',
      status: 'fail',
      error: err,
    })
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
