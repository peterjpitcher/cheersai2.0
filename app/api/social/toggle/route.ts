import { NextRequest, NextResponse } from 'next/server';
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

    const parsed = z.object({ accountId: z.string().uuid(), isActive: z.boolean() }).safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'accountId and isActive are required', parsed.error.format(), request)
    }
    const { accountId, isActive } = parsed.data

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
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', accountId)
      .eq('tenant_id', userData.tenant_id);

    if (error) {
      return serverError('Failed to update account status', error, request)
    }

    return ok({ ok: true }, request)
  } catch (err) {
    return serverError('Unexpected error', undefined, request)
  }
}
