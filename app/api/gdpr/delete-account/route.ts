import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { unauthorized, notFound, badRequest, ok, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    const { data: user } = await supabase.auth.getUser();
    
    if (!user.user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const parsed = z.object({ reason: z.string().optional() }).safeParse(await request.json())
    const reason = parsed.success ? parsed.data.reason : undefined

    // Check if user already has a pending deletion request
    const { data: existingRequest } = await supabase
      .from('user_deletion_requests')
      .select('id, status')
      .eq('user_id', user.user.id)
      .eq('status', 'pending')
      .single();

    if (existingRequest) {
      return badRequest(
        'deletion_pending',
        'Account deletion already requested',
        { message: 'You already have a pending account deletion request. UK data protection law requires a 30-day retention period.' },
        request,
      )
    }

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.user.id)
      .single();

    if (!userData) {
      return notFound('User data not found', undefined, request)
    }

    // Create deletion request
    const { error: requestError } = await supabase
      .from('user_deletion_requests')
      .insert({
        user_id: user.user.id,
        tenant_id: userData.tenant_id,
        deletion_reason: reason || 'User requested account deletion',
        status: 'pending'
      });

    if (requestError) {
      reqLogger.error('Error creating deletion request', {
        area: 'gdpr',
        op: 'account.delete',
        status: 'fail',
        error: requestError,
      })
      return serverError('Failed to create deletion request', requestError.message, request)
    }

    // Trigger soft delete of user data (starts 30-day UK ICO retention period)
    const { error: deleteError } = await supabase.rpc('soft_delete_user_account', {
      p_user_id: user.user.id
    });

    if (deleteError) {
      reqLogger.error('Error soft deleting user data', {
        area: 'gdpr',
        op: 'account.delete',
        status: 'fail',
        error: deleteError,
      })
      return serverError('Failed to initiate account deletion', deleteError.message, request)
    }

    // Update deletion request status
    await supabase
      .from('user_deletion_requests')
      .update({ status: 'processing' })
      .eq('user_id', user.user.id);

    // Log the deletion request
    reqLogger.info('Account deletion requested', {
      area: 'gdpr',
      op: 'account.delete',
      status: 'ok',
      userId: user.user.id,
    })

    return ok({
      success: true,
      message: "Account deletion initiated. Per UK data protection law, your data will be permanently deleted in 30 days.",
      deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      uk_ico_compliant: true
    }, request);

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Account deletion error', {
      area: 'gdpr',
      op: 'account.delete',
      status: 'fail',
      error: err,
    })
    logger.error('Account deletion error', {
      area: 'gdpr',
      op: 'account.delete',
      status: 'fail',
      error: err,
    })
    return serverError('Account deletion failed', { message: err.message }, request)
  }
}
