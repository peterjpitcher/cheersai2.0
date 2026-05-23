'use client';

import { useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail } from 'lucide-react';

import { sendMagicLink, signInWithPassword } from '@/lib/auth/actions';

/**
 * Login page with email/password as the primary method.
 * Split-screen layout: dark brand panel left, auth form right.
 * Magic link auth is available via a small secondary link.
 */
export default function LoginPage() {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') ?? '/dashboard';

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
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left panel — dark brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between px-12 py-10 xl:px-16"
        style={{ backgroundColor: "var(--c-ink)" }}
      >
        {/* Brand mark */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-[var(--r-lg)] text-lg font-bold text-white"
            style={{ backgroundColor: "var(--c-orange)" }}
          >
            C
          </div>
          <span className="text-lg font-semibold text-white">CheersAI</span>
        </div>

        {/* Headline */}
        <div className="max-w-[420px] space-y-4">
          <h1 className="text-[28px] font-semibold leading-tight text-white">
            Your venue&apos;s social media, sorted.
          </h1>
          <p className="text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
            Create once, publish everywhere. CheersAI adapts your content for
            Facebook, Instagram, and Google Business Profile — so you can focus
            on running your venue.
          </p>
        </div>

        {/* Testimonial */}
        <div
          className="max-w-[360px] space-y-3 p-5"
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "var(--r-xl)",
          }}
        >
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.85)" }}>
            &ldquo;CheersAI changed how we handle our socials. What used to
            take hours now takes minutes.&rdquo;
          </p>
          <div>
            <p className="text-sm font-semibold text-white">Sarah Mitchell</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              The Rose &amp; Crown, Surrey
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — auth form */}
      <div
        className="flex items-center justify-center px-6 py-12"
        style={{ backgroundColor: "var(--c-card)" }}
      >
        <div className="w-full max-w-[400px] space-y-8">
          {/* Mobile brand mark (hidden on lg) */}
          <div className="flex items-center justify-center gap-3 lg:hidden">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[var(--r-lg)] text-lg font-bold text-white"
              style={{ backgroundColor: "var(--c-orange)" }}
            >
              C
            </div>
            <span className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>
              CheersAI
            </span>
          </div>

          <div className="space-y-2 text-center">
            <h2
              className="text-2xl font-semibold tracking-tight"
              style={{ color: "var(--c-ink)" }}
            >
              Sign in to your account
            </h2>
            <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
              {authMode === 'magic-link'
                ? 'Enter your email to receive a magic link'
                : 'Enter your email and password to continue'}
            </p>
          </div>

          <div className="space-y-6">
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
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  full
                  icon={Mail}
                  disabled={isBusy}
                >
                  {magicLinkPending ? 'Sending...' : 'Send magic link'}
                </Button>

                {magicLinkState?.error && (
                  <div
                    className="rounded-[var(--r-md)] p-3 text-sm text-center font-medium"
                    style={{
                      backgroundColor: "var(--c-claret-soft)",
                      color: "var(--c-claret)",
                    }}
                  >
                    {magicLinkState.error}
                  </div>
                )}
              </form>
            )}

            {/* Magic link sent success */}
            {magicLinkSuccess && (
              <div
                className="rounded-[var(--r-md)] p-4 text-sm text-center font-medium"
                style={{
                  backgroundColor: "var(--c-status-posted-bg)",
                  color: "var(--c-status-posted-fg)",
                }}
              >
                <p className="font-semibold mb-1">Check your email</p>
                <p>
                  We sent a magic link to your email address. Click the link to
                  sign in.
                </p>
              </div>
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
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  full
                  disabled={isBusy}
                >
                  {passwordPending ? 'Signing in...' : 'Sign in'}
                </Button>

                {passwordState?.error && (
                  <div
                    className="rounded-[var(--r-md)] p-3 text-sm text-center font-medium"
                    style={{
                      backgroundColor: "var(--c-claret-soft)",
                      color: "var(--c-claret)",
                    }}
                  >
                    {passwordState.error}
                  </div>
                )}
              </form>
            )}

            {/* Mode toggle */}
            {!magicLinkSuccess && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() =>
                    setAuthMode((prev) =>
                      prev === 'magic-link' ? 'password' : 'magic-link',
                    )
                  }
                  className="text-sm underline-offset-4 hover:underline transition-colors"
                  style={{ color: "var(--c-ink-3)" }}
                >
                  {authMode === 'magic-link'
                    ? 'Use password instead'
                    : 'Use magic link instead'}
                </button>
              </div>
            )}
          </div>

          {/* Footer microcopy */}
          <div className="text-center space-y-2">
            <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
              Don&apos;t have an account?{' '}
              <a
                href="mailto:peter@orangejelly.co.uk"
                className="font-semibold hover:underline"
                style={{ color: "var(--c-orange)" }}
              >
                Contact support
              </a>
            </p>
            <p className="text-xs" style={{ color: "var(--c-ink-4)" }}>
              <Link href="/terms" className="hover:underline">Terms</Link>
              {' '}&middot;{' '}
              <Link href="/privacy" className="hover:underline">Privacy</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
