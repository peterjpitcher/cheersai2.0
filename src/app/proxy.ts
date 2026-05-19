/**
 * Next.js 16 proxy.ts -- replaces middleware.ts.
 * Auth guard for all (app)/* routes (AUTH-02, D-07).
 *
 * Critical: uses getUser() (NOT getSession()) for JWT validation.
 * See RESEARCH.md Pitfall 2.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Paths that skip auth -- public routes */
const PUBLIC_PATH_PREFIXES = [
  '/auth/',
  '/(auth)/',
  '/api/auth/',
  '/l/',
  '/_next/',
];

/** Static file extensions that skip auth */
const STATIC_FILE_RE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

function isPublicPath(pathname: string): boolean {
  if (pathname === '/favicon.ico') return true;
  if (STATIC_FILE_RE.test(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Public routes bypass auth check
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Create a response we can attach refreshed cookies to
  const response = NextResponse.next();

  // Create Supabase client with cookie access pattern (RESEARCH.md Pattern 2)
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

  // Use getUser() (NOT getSession()) to validate JWT server-side (D-07, Pitfall 2)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Redirect unauthenticated users to login with return URL
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // User is authenticated -- return response with refreshed cookies
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
