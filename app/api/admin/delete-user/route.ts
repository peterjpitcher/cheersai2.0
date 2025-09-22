import { NextRequest } from 'next/server'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { ok, badRequest, unauthorized, forbidden, serverError, notFound } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const authHeader = request.headers.get('authorization') ?? ''
    const secret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET

    if (!secret) {
      reqLogger.error('Missing INTERNAL_API_SECRET/CRON_SECRET for admin delete-user', {
        area: 'admin',
        op: 'delete-user',
        status: 'fail',
      })
      return serverError('Server misconfiguration', undefined, request)
    }

    if (!authHeader.startsWith('Bearer ') || authHeader.slice('Bearer '.length).trim() !== secret) {
      reqLogger.warn('Admin delete-user rejected due to invalid secret', {
        area: 'admin',
        op: 'delete-user',
        status: 'fail',
      })
      return unauthorized('Unauthorized', undefined, request)
    }

    const body = await request.json()
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null

    if (!email) {
      reqLogger.warn('Admin delete-user rejected missing email payload', {
        area: 'admin',
        op: 'delete-user',
        status: 'fail',
      })
      return badRequest('missing_email', 'email is required', undefined, request)
    }
    
    // Only allow this in development
    if (process.env.NODE_ENV === 'production') {
      return forbidden('Not allowed in production', undefined, request)
    }
    
    // Use service role to bypass RLS
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      reqLogger.error('Missing Supabase service role configuration for admin delete-user', {
        area: 'admin',
        op: 'delete-user',
        status: 'fail',
      })
      return serverError('Server misconfiguration', undefined, request)
    }

    const supabase = await createServiceRoleClient()

    let userId: string | null = null
    const { data: userRow } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle<{ id: string }>()

    userId = userRow?.id ?? null

    if (!userId) {
      const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 })
      if (listError) {
        reqLogger.error('Admin delete-user failed to list users', {
          area: 'admin',
          op: 'delete-user',
          status: 'fail',
          error: listError,
        })
        return serverError('Failed to locate user', { message: listError.message }, request)
      }
      const match = listed.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
      userId = match?.id ?? null
    }

    if (!userId) {
      return notFound('User not found', undefined, request)
    }

    const { data: authUser, error: fetchUserError } = await supabase.auth.admin.getUserById(userId)

    if (fetchUserError) {
      reqLogger.error('Admin delete-user failed to fetch user by id', {
        area: 'admin',
        op: 'delete-user',
        status: 'fail',
        error: fetchUserError,
        meta: { email, userId },
      })
      return serverError('Failed to locate user', { message: fetchUserError.message }, request)
    }

    const user = authUser?.user

    reqLogger.info('Admin delete-user located user', {
      area: 'admin',
      op: 'delete-user',
      status: 'pending',
      userId: user.id,
      meta: { email },
    })
    
    // Get tenant ID
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    
    const tenantId = userData?.tenant_id;
    
    if (tenantId) {
      reqLogger.info('Admin delete-user located tenant', {
        area: 'admin',
        op: 'delete-user',
        status: 'pending',
        tenantId,
        meta: { userId: user.id },
      })
      
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
      reqLogger.error('Error deleting Supabase auth user', {
        area: 'admin',
        op: 'delete-user',
        status: 'fail',
        error: deleteError,
        meta: { userId: user.id, email },
      })
      return serverError('Failed to delete Supabase auth user', { message: deleteError.message }, request)
    }

    reqLogger.info('Admin delete-user completed', {
      area: 'admin',
      op: 'delete-user',
      status: 'ok',
      meta: { userId: user.id, tenantId, email },
    })

    return ok({ success: true, message: `User ${email} and all related data has been deleted` }, request)
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Delete user error', {
      area: 'admin',
      op: 'delete-user',
      status: 'fail',
      error: err,
    })
    logger.error('Admin delete-user error', {
      area: 'admin',
      op: 'delete-user',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to delete user', { message: err.message }, request)
  }
}
