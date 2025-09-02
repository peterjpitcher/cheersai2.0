# Auth & App Review Recommendations

**Date:** 2025-01-02  
**Reviewer:** Senior Developer  
**Status:** Implementation In Progress

## Executive Summary

This document captures comprehensive recommendations for standardizing the authentication flow, minimizing code drift, hardening redirects/cookies, and making revalidation consistent across the CheersAI application.

## Top Priorities

1. **Align on one email flow**: Use `verifyOtp` + `token_hash` for email confirmation/magic links; keep PKCE only for OAuth
2. **Enforce verification** at platform (Supabase Confirm Email) and app layers (middleware + login guard)
3. **Move final onboarding redirect** server-side and revalidate server-side
4. **Unify Supabase client usage** and cookie handling across middleware/server routes

## Supabase Dashboard Configuration

### Required Settings

- **Site URL:** `https://cheersai.orangejelly.co.uk`
- **Redirect URLs** (exact paths):
  - `https://cheersai.orangejelly.co.uk/auth/confirm`
  - `https://cheersai.orangejelly.co.uk/auth/callback` (keep for OAuth/PKCE)
  - `https://cheersai.orangejelly.co.uk/auth/reset-password`
- **Confirm Email:** Enable in Auth → Providers → Email
- **Email templates:**
  - Confirm signup: link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
  - Magic link: same confirm route shape using `token_hash`
  - Reset password: point to `/auth/reset-password`

## Implementation Checklist

### Auth Flow Standardization

- [ ] **Email/password signup** (`app/auth/signup/page.tsx`)
  - Stop using PKCE `?code=` for confirmation
  - Remove `emailRedirectTo` that conflicts with `verifyOtp` flow
  - Use template `token_hash` link to `/auth/confirm`

- [ ] **Magic link** (`app/auth/login/page.tsx`, `app/auth/actions.ts`)
  - Keep `emailRedirectTo` as `/auth/confirm`
  - Standardize between `/auth/callback` vs `/auth/confirm`

- [ ] **OAuth**
  - Keep `/auth/callback` and PKCE (`exchangeCodeForSession`) only for social providers

### Route Updates

- [ ] **Confirm Route** (`app/auth/confirm/route.ts`)
  - Ensure it always removes `token_hash` and `type` from post-verify redirect URL
  - Keep default next as `/dashboard`
  - Handle `missing_params` and Supabase errors with clear `/auth/error` redirect

- [ ] **Callback Route** (`app/auth/callback/route.ts`)
  - Use single `NextResponse` passed into `createServerClient`
  - Avoid dual cookie stores
  - Keep logic limited to PKCE/OAuth

### Middleware Enhancement

- [ ] **Middleware** (`middleware.ts`, `lib/supabase/middleware.ts`)
  - Enforce email verification for protected routes
  - If `user && !user.email_confirmed_at && !isPublic`, redirect to `/auth/check-email`
  - Exclude `/auth`, `/api` (as appropriate), and static
  - Reuse single middleware helper from `lib/supabase/middleware.ts`
  - Keep NextResponse-centric cookie writes with secure defaults

### Supabase Client Utilities

- [ ] **Standardize cookie options** (`lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/auth-cache.ts`)
  - Path: `/`
  - SameSite: `lax`
  - HttpOnly: `true`
  - Secure: `true` in production
  - Unify server client creation via single exported function

### Onboarding Flow

- [ ] **Server-side redirect** (`app/onboarding/page.tsx`, `app/actions/onboarding.ts`)
  - Perform redirect inside Server Action using `redirect('/dashboard')`
  - Use `Buffer.from(base64, 'base64')` instead of `atob/Blob` for logo upload
  - Keep dashboard `force-dynamic`

### Login and Verification Guards

- [ ] **Verification enforcement** (`app/auth/login/page.tsx`, `app/auth/actions.ts`)
  - Keep guard until Confirm Email is enforced in Supabase
  - Standardize redirects and messages
  - Add "Resend confirmation" call-to-action on `/auth/check-email`

### Email Templates & User Messaging

- [ ] **User experience** (`app/auth/check-email/page.tsx`, `app/auth/error/page.tsx`)
  - Add "Resend confirmation" flow
  - Ensure `/auth/error` shows actionable messages for:
    - `expired_link`
    - `already_used`
    - `missing_params`

### API Route Hardening

- [ ] **Consistent pattern** across all `app/api/**`:
  - Authenticate with `supabase.auth.getUser()`
  - Resolve tenant with single query or via RPC
  - Return structured JSON errors
  - Log server-side errors

### Caching & Revalidation

- [ ] **Server Components**:
  - Keep `export const dynamic = 'force-dynamic'` where personalized data is read
  - Prefer server-side redirects (`redirect`) after mutations
  - Avoid client-side `router.refresh()`/timeouts as cache-busting strategy

### Environment & Config

- [ ] **Environment variables**:
  - `NEXT_PUBLIC_SITE_URL=https://cheersai.orangejelly.co.uk`
  - Production values for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Single source of truth for app URL

### Security

- [ ] **Platform security**:
  - Confirm Email: enabled in Supabase
  - MFA: consider enabling TOTP for admins
  - RLS: continue using RPC for complex mutations
  - CORS: verify allowed origins and headers
  - Rate limiting: ensure sensitive API routes protected

### Observability

- [ ] **Centralize auth error logging**:
  - Confirm route failures (reason and user agent)
  - Callback exchange errors (PKCE/OAuth)
  - Login failures and "unverified" path usage
  - Add helpdesk/ops logs for spikes in `/auth/error` reasons

### Consistency Clean-ups

- [ ] **Remove duplication**:
  - Between `middleware.ts` and `lib/supabase/middleware.ts`
  - Cookie policies in `lib/supabase/server.ts` and `lib/supabase/auth-cache.ts`
  - Redirect URLs and flow choice across auth pages
  - Use `.single()` consistently on single-row queries

## Testing Requirements

### E2E Tests
1. Signup → email confirm via `token_hash` → land on `/dashboard` (no secret params)
2. Unverified login blocked until confirm; verify middleware redirect to `/auth/check-email`
3. Onboarding server action redirects to `/dashboard` with no loop

### Integration Tests
1. Dashboard page reads fresh tenant after server action `revalidatePath`

### Unit Tests
1. Email template rendering contains `token_hash` and `type=email`

## Implementation Progress

| Component | Status | Notes |
|-----------|--------|-------|
| Supabase Dashboard Config | Pending | Need to update email templates |
| Auth Flow Standardization | In Progress | Starting with signup/login |
| Middleware Enhancement | Pending | |
| Cookie Standardization | Pending | |
| Onboarding Flow | Pending | |
| Resend Confirmation | Pending | |
| Testing | Pending | |

## Next Steps

1. Update Supabase email templates to use `token_hash` format
2. Remove PKCE from email confirmation flow
3. Implement middleware email verification enforcement
4. Standardize cookie handling across all Supabase clients
5. Fix onboarding to use server-side redirect
6. Add resend confirmation functionality
7. Clean up code duplication
8. Implement comprehensive testing

## Notes

- Keep PKCE flow only for OAuth/social providers
- Ensure all changes maintain backward compatibility during transition
- Test thoroughly in staging before production deployment