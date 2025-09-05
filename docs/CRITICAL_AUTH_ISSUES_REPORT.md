# 🚨 CRITICAL AUTHENTICATION ISSUES - URGENT ESCALATION REQUIRED

**Date:** 2025-01-09  
**Severity:** CRITICAL - Production Authentication Broken  
**Impact:** Users cannot complete signup/onboarding  

---

## EXECUTIVE SUMMARY

Three critical authentication issues are blocking new signups and allowing risky access paths:

1. **Confirm link 403 / “One-time token not found”** due to wrong email link shape and misaligned Supabase URL configuration.
2. **Verification bypass** because Supabase Confirm Email is disabled or app lacks a guard.
3. **Onboarding loop** from cached dashboard reads after mutation; needs server-side revalidation and dynamic page.

Address URL config + email templates first, then enforcement and caching.

---

## ISSUE 1: SIGNUP EMAIL CONFIRMATION FAILURE

### Symptoms
- User signs up successfully
- Receives confirmation email  
- Clicking link shows "Authentication Error: One-time token not found"
- Supabase logs show: `403: Email link is invalid or has expired`

### Root Cause Analysis

#### Current Flow vs. Link Shape
- The app uses SSR `verifyOtp({ type, token_hash })` at `/auth/confirm`.
- Supabase’s default `{{ .ConfirmationURL }}` or PKCE templates generate `?code=…` links, which do not work with `verifyOtp`.

#### Actual Causes
1. **Email link shape mismatch**: emails still send `?code=` links instead of `?token_hash=…&type=email` required by `verifyOtp`.
2. **Supabase URL configuration**: `Site URL` and `Redirect URLs` don’t include the exact confirm path; Supabase rejects/rewrites links if not whitelisted.

### Required Fixes (Immediate)
1. **Supabase Dashboard → Auth → URL Configuration**
   - Set `Site URL` to `https://cheersai.orangejelly.co.uk`.
   - Add an explicit redirect: `https://cheersai.orangejelly.co.uk/auth/confirm`.
2. **Email templates** (Confirm signup): use `token_hash` link
   ```html
   <!-- Replace ConfirmationURL/PKCE link with verifyOtp-compatible link -->
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
   ```
3. **Confirm route harden**: ensure handler reads `token_hash` + `type`, calls `verifyOtp`, strips secrets, then redirects. See snippet in “Code Snippets”.

---

## ISSUE 2: EMAIL VERIFICATION BYPASS

### Symptoms
- User gets authentication error from confirmation email
- Can immediately login with same credentials
- **SECURITY RISK:** Unverified emails can access system

### Root Cause Analysis

#### Current Behavior
```typescript
// Login page allows immediate access
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});

if (data?.session) {
  router.push("/dashboard");  // Missing email verification guard
}
```

#### Missing Verification
- Supabase project likely has Confirm Email disabled, or
- App does not check `user.email_confirmed_at`, and
- Middleware does not enforce verification for protected routes.

### Security Impact
- **HIGH RISK:** Unverified users can access tenant data
- Potential for fake email registrations
- Compliance issues (GDPR requires verified consent)

### Required Fixes
1. **Re-enable Confirm Email** in Supabase (Auth → Providers → Email).
2. **Add app-side guard (defence in depth)** in login and middleware:
   - Login: block if `!user.email_confirmed_at` and offer resend.
   - Middleware: redirect unverified users away from app areas (exclude `/auth`, `/api`).
   - See “Code Snippets”.

---

## ISSUE 3: ONBOARDING INFINITE LOOP

### Symptoms
- User completes all 4 onboarding steps
- Clicks "Complete Setup"
- Successfully creates tenant and brand profile
- **BUG:** Redirected back to onboarding start instead of dashboard

### Root Cause Analysis

#### What’s happening
- After onboarding mutates data (create tenant, membership), the dashboard render uses cached data and still “sees” no tenant, so it redirects back to onboarding.
- Client-side `router.refresh()` + delays are unreliable under App Router caching.

### Required Fixes
1. **Move final submit to a Server Action** that performs the mutation, then:
   - `revalidatePath('/dashboard')`
   - `redirect('/dashboard')`
2. **Make the dashboard dynamic (or revalidated)** until tag-based revalidation is added:
   - `export const dynamic = 'force-dynamic'` (or `export const revalidate = 0`).
3. **Fix the tenant query** to use `.single()` and an explicit join, avoiding array checks.
   - See “Code Snippets”.

---

## FIX PLAN (ORDERED)

1. Supabase URL configuration (IMMEDIATE)
   - `Site URL` → `https://cheersai.orangejelly.co.uk`
   - Redirects: add `https://cheersai.orangejelly.co.uk/auth/confirm` (and `/auth/callback` if using PKCE/OAuth)
2. Email templates (IMMEDIATE)
   - Confirm button → `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Do not use `{{ .ConfirmationURL }}` if standardising on `verifyOtp`
3. Enforce email verification
   - Re-enable Confirm Email in Supabase; block unverified in app (login + middleware)
4. Confirm route harden
   - Ensure `/auth/confirm` reads `token_hash` + `type`, calls `verifyOtp`, strips secrets, then redirects
5. Onboarding submit → Server Action
   - Mutate + `revalidatePath('/dashboard')` + `redirect('/dashboard')`
6. Dashboard caching
   - Mark dynamic or `revalidate = 0`; use `.single()` on tenant query
7. Safety nets
   - Add “Resend confirmation”; log auth errors to helpdesk logs; verify envs

See “Code Snippets” for reference implementations.

---

## CODE SNIPPETS (REFERENCE)

### Confirm route (SSR `verifyOtp`)
```ts
// app/auth/confirm/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = url.searchParams.get('next') ?? '/dashboard'

  // Prepare a redirect without secrets
  const redirectUrl = new URL(next, url.origin)

  if (!token_hash || !type) {
    redirectUrl.pathname = '/auth/error'
    redirectUrl.searchParams.set('reason', 'missing_params')
    return NextResponse.redirect(redirectUrl)
  }

  const res = NextResponse.redirect(redirectUrl)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set: (name, value, options) =>
          res.cookies.set({ name, value, ...options, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }),
        remove: (name, options) =>
          res.cookies.set({ name, value: '', ...options, path: '/', maxAge: 0, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }),
      },
    }
  )

  const { error } = await supabase.auth.verifyOtp({ type, token_hash })
  if (error) {
    const errUrl = new URL('/auth/error', url.origin)
    errUrl.searchParams.set('reason', error.message)
    return NextResponse.redirect(errUrl)
  }

  return res // cookies from verifyOtp are attached to res
}
```

### Login guard (block unverified)
```ts
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
if (error) return setFormError(error.message)
const user = data.user
if (!user?.email_confirmed_at) {
  return setFormError('Please confirm your email first. We\'ve resent the link.')
}
router.push('/dashboard')
```

### Middleware (defence in depth)
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (k) => req.cookies.get(k)?.value,
        set: (k, v, opts) => res.cookies.set({ name: k, value: v, ...opts, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }),
        remove: (k, opts) => res.cookies.set({ name: k, value: '', ...opts, path: '/', maxAge: 0, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }),
      },
    }
  )

  const { data } = await supabase.auth.getUser()
  const user = data.user
  const pathname = req.nextUrl.pathname
  const isPublic = pathname.startsWith('/auth') || pathname.startsWith('/api') || pathname === '/'

  if (user && !user.email_confirmed_at && !isPublic) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/check-email'
    return NextResponse.redirect(url, { headers: res.headers })
  }
  return res
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

### Onboarding Server Action + revalidate
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@supabase/ssr'
import { redirect } from 'next/navigation'

export async function completeOnboarding(formData: FormData) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user }, error: uerr } = await supabase.auth.getUser()
  if (uerr || !user) throw new Error('Not authenticated')

  // create tenant + membership (pseudocode)
  const { error: terr } = await supabase.from('tenants').insert({ name: formData.get('name') })
  if (terr) throw terr
  // ... link user to tenant, etc.

  revalidatePath('/dashboard')
  redirect('/dashboard')
}
```

### Dashboard (dynamic + single query)
```ts
export const dynamic = 'force-dynamic' // or: export const revalidate = 0
import { createServerClient } from '@supabase/ssr'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('users')
    .select('*, tenants!inner(*)')
    .eq('id', user!.id)
    .single()
  const tenant = (profile as any)?.tenants
  if (!tenant) redirect('/onboarding')
  return <Dashboard tenant={tenant} />
}
```

---

## TESTING CHECKLIST

### Manual Test Flow
1. [ ] Sign up with new email
2. [ ] Receive confirmation email
3. [ ] Confirm via `token_hash` link → land on `/dashboard` (no token in URL)
4. [ ] Complete onboarding (Server Action) → redirect to dashboard
5. [ ] Logout and login → works after verification
6. [ ] Try login without confirming → blocked with helpful message

### Automated Tests Needed
- Confirm-email flow: signup → open `token_hash` link → cookies set → redirected without secrets
- Unverified blocked: login before confirm → expect blocked + resend path
- Onboarding flow: server action redirects and revalidates dashboard (no loop)
- Dashboard dynamic: reads fresh tenant after mutation

---

## ENVIRONMENT & SUPABASE SETTINGS TO VERIFY

```env
NEXT_PUBLIC_SITE_URL=https://cheersai.orangejelly.co.uk  # ADD THIS
NEXT_PUBLIC_APP_URL=https://cheersai.orangejelly.co.uk  # Verify exists
NEXT_PUBLIC_SUPABASE_URL=<your-project-url>  # Verify correct
```

- Supabase Dashboard → Auth → URL Configuration
  - Site URL = `https://cheersai.orangejelly.co.uk`
  - Redirect URLs include: `https://cheersai.orangejelly.co.uk/auth/confirm`
- Supabase → Auth → Providers → Email
  - Confirm Email = Enabled

---

## ROLLBACK PLAN

If issues arise during rollout:
1. Temporarily relax the middleware’s unverified redirect (do NOT disable Confirm Email in Supabase).
2. Provide a manual verification path via support while stabilising.
3. Communicate with affected users and offer a “Resend confirmation” link.

---

## OPEN QUESTIONS

1. Are emails currently sending `?code=` or `?token_hash=` links?
2. Is Confirm Email enabled in the Supabase project now?
3. Are OAuth providers enabled (Google, etc.)? If yes, keep `/auth/callback` for PKCE-only flows as well.

---

## CONTACTS FOR ESCALATION

- **Supabase Support:** For dashboard configuration
- **Senior Developer:** For architecture review
- **DevOps:** For environment variable deployment

---

**THIS IS BLOCKING ALL NEW USER SIGNUPS - IMMEDIATE ACTION REQUIRED**

---

*Report generated: 2025-01-09*  
*Next review: Within 2 hours*
