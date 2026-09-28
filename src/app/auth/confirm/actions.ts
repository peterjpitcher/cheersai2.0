'use server';

import { redirect } from 'next/navigation';

import { reportAuthFailure } from '@/lib/auth/alerts';
import { parseConfirmLinkParams, SUPABASE_OTP_TYPE } from '@/lib/auth/confirm-link';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * A used, expired or wrong token (Supabase answers 4xx, usually 403
 * otp_expired). Anything else (no network, 429, 5xx) means we could not check
 * the link, which is then most likely still unused.
 */
function isLinkProblem(error: { status?: number }): boolean {
  return typeof error.status === 'number' && error.status >= 400 && error.status < 500 && error.status !== 429;
}

/**
 * The "Confirm and continue" button on /auth/confirm. Only this POST uses the
 * one-time token, so an email scanner that fetches the link (a GET) cannot
 * use it up. Server actions check the Origin header against the host, so
 * another site cannot submit a token here to sign a visitor in as someone else.
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  const params = parseConfirmLinkParams({
    token_hash: formData.get('token_hash'),
    type: formData.get('type'),
    next: formData.get('next'),
  });
  if (!params) redirect('/login?error=invalid_confirmation');

  let outcome: 'ok' | 'link_problem' | 'unavailable' = 'ok';
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: SUPABASE_OTP_TYPE[params.type] });
    if (error && isLinkProblem(error)) {
      console.error('[auth] confirm link refused:', error.status, error.message);
      outcome = 'link_problem';
    } else if (error) {
      await reportAuthFailure('email_link', new Error(`verifyOtp: ${error.code ?? error.status ?? ''} ${error.message}`));
      outcome = 'unavailable';
    }
  } catch (error) {
    await reportAuthFailure('email_link', error);
    outcome = 'unavailable';
  }

  // redirect() throws, so it stays outside the try block.
  if (outcome === 'link_problem') redirect('/login?error=confirmation_failed');
  if (outcome === 'unavailable') redirect('/login?error=confirmation_unavailable');
  redirect(params.next);
}
