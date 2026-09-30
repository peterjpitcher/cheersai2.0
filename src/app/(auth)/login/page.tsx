'use client';

import { useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail } from 'lucide-react';

import { AUTH_INPUT, AUTH_LINK, AUTH_QUIET_LINK, AuthAside, AuthCard, AuthMessage } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HERO } from '@/content/homepage';
import { sendMagicLink, signInWithPassword } from '@/lib/auth/actions';
import { safeNextPath } from '@/lib/auth/email-links';
import { CONTACT } from '@/lib/legal/company';

/** Error codes set by /auth/confirm, /auth/callback and /auth/set-password. */
const LINK_ERRORS = new Set(['invalid_confirmation', 'confirmation_failed', 'auth_callback_failed', 'link_expired']);
/** Set by /auth/confirm when Supabase could not check the link (it is most likely still unused). */
const LINK_UNAVAILABLE = 'confirmation_unavailable';

/**
 * Login page with email/password as the primary method, in the homepage's
 * look (AuthCard): from lg the hero-style panel sits left and the form card
 * right; below lg only the card. Magic link auth is available via a small
 * secondary link.
 */
export default function LoginPage() {
  const searchParams = useSearchParams();
  // Same-origin paths only: `?next=` is attacker-controlled (open redirect, `javascript:`).
  const nextUrl = safeNextPath(searchParams.get('next'), '/dashboard');
  const linkError = LINK_ERRORS.has(searchParams.get('error') ?? '');
  const linkUnavailable = searchParams.get('error') === LINK_UNAVAILABLE;

  const [authMode, setAuthMode] = useState<'magic-link' | 'password'>('password');

  // Magic link form state
  const [magicLinkState, magicLinkAction, magicLinkPending] = useActionState(
    async (_prevState: { success?: boolean; error?: string } | null, formData: FormData) => {
      return sendMagicLink(formData);
    },
    null,
  );

  // Password form state
  const [passwordState, passwordAction, passwordPending] = useActionState(
    async (_prevState: { success?: boolean; error?: string } | null, formData: FormData) => {
      const result = await signInWithPassword(formData);
      if (result.success) {
        // Redirect after successful password login
        window.location.href = nextUrl;
      }
      return result;
    },
    null,
  );

  const isBusy = magicLinkPending || passwordPending;
  const magicLinkSuccess = magicLinkState?.success === true;

  return (
    <AuthCard
      title="Sign in to your account"
      description={
        authMode === 'magic-link'
          ? 'Enter your email to receive a magic link'
          : 'Enter your email and password to continue'
      }
      aside={
        <AuthAside
          eyebrow={HERO.eyebrow}
          title="Your venue's social media,"
          accent="sorted."
          intro="Create once, publish everywhere. Cheers adapts your content for Facebook and Instagram, so you can focus on running your venue."
          points={HERO.points}
        />
      }
    >
      {linkError && (
        <AuthMessage tone="error">
          That link has expired or was already used.{' '}
          <Link href="/forgot-password" className="underline">
            Send it again
          </Link>
        </AuthMessage>
      )}

      {linkUnavailable && (
        <AuthMessage tone="error">
          We could not check your link just now. Open it from your email again in a minute, or email{' '}
          <a href={`mailto:${CONTACT.email}`} className="underline">
            {CONTACT.email}
          </a>
          .
        </AuthMessage>
      )}

      {/* Magic link form */}
      {authMode === 'magic-link' && !magicLinkSuccess && (
        <form action={magicLinkAction} className="space-y-4">
          <input type="hidden" name="next" value={nextUrl} />
          <div className="space-y-2">
            <Label htmlFor="magic-email">Email</Label>
            <Input
              id="magic-email"
              name="email"
              type="email"
              placeholder="you@yourvenue.com"
              required
              autoComplete="email"
              autoFocus
              className={AUTH_INPUT}
            />
          </div>
          <Button type="submit" variant="cta" size="xl" full icon={Mail} disabled={isBusy}>
            {magicLinkPending ? 'Sending...' : 'Send magic link'}
          </Button>

          {magicLinkState?.error && <AuthMessage tone="error">{magicLinkState.error}</AuthMessage>}
        </form>
      )}

      {/* Magic link sent success */}
      {magicLinkSuccess && (
        <AuthMessage tone="success">
          <span className="mb-1 block font-semibold">Check your email</span>
          We sent a magic link to your email address. Click the link to sign in.
        </AuthMessage>
      )}

      {/* Password form */}
      {authMode === 'password' && !magicLinkSuccess && (
        <form action={passwordAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password-email">Email</Label>
            <Input
              id="password-email"
              name="email"
              type="email"
              placeholder="you@yourvenue.com"
              required
              autoComplete="email"
              autoFocus
              className={AUTH_INPUT}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className={`text-sm ${AUTH_QUIET_LINK}`}>
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={AUTH_INPUT}
            />
          </div>
          <Button type="submit" variant="cta" size="xl" full disabled={isBusy}>
            {passwordPending ? 'Signing in...' : 'Sign in'}
          </Button>

          {passwordState?.error && <AuthMessage tone="error">{passwordState.error}</AuthMessage>}
        </form>
      )}

      {/* Mode toggle */}
      {!magicLinkSuccess && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setAuthMode((prev) => (prev === 'magic-link' ? 'password' : 'magic-link'))}
            className={`text-sm transition-colors ${AUTH_QUIET_LINK}`}
          >
            {authMode === 'magic-link' ? 'Use password instead' : 'Use magic link instead'}
          </button>
        </div>
      )}

      <p className="border-t border-line pt-6 text-center text-sm text-ink-2">
        Don&apos;t have an account?{' '}
        <a href={`mailto:${CONTACT.email}`} className={AUTH_LINK}>
          Contact support
        </a>
      </p>
    </AuthCard>
  );
}
