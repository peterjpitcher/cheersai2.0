import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Email confirmation handler.
 * Handles the token_hash + type flow for signup confirmation.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as
    | 'signup'
    | 'recovery'
    | 'invite'
    | 'email'
    | 'magiclink'
    | null;
  const next = searchParams.get('next') ?? '/dashboard';

  if (!tokenHash || !type) {
    const loginUrl = new URL('/auth/login', origin);
    loginUrl.searchParams.set('error', 'invalid_confirmation');
    return NextResponse.redirect(loginUrl);
  }

  const redirectUrl = new URL(next, origin);
  const response = NextResponse.redirect(redirectUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    console.error('[auth] confirm verification failed:', error.message);
    const loginUrl = new URL('/auth/login', origin);
    loginUrl.searchParams.set('error', 'confirmation_failed');
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
