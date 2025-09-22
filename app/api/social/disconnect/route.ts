import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod'
import { unauthorized, badRequest, notFound, ok, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const parsed = z.object({ accountId: z.string().uuid() }).safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'accountId is required', parsed.error.format(), request)
    }
    const { accountId } = parsed.data

    // Verify the connection belongs to the current user's tenant
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }

    const { error } = await supabase
      .from('social_connections')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', accountId)
      .eq('tenant_id', userData.tenant_id);

    if (error) {
      return serverError('Failed to disconnect account', error, request)
    }

    return ok({ ok: true }, request)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    return serverError('Unexpected error', err, request)
  }
}
