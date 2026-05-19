'use client';

import { useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Mail } from 'lucide-react';

import { sendMagicLink, signInWithPassword } from '@/lib/auth/actions';

/**
 * Login page with magic link as primary method (D-04).
 * Password auth is available via a small "Use password instead" link.
 */
export default function LoginPage() {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') ?? '/dashboard';

  const [showPassword, setShowPassword] = useState(false);

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
    <div className="w-full max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-heading font-bold tracking-tight">
          Sign in to CheersAI
        </h1>
        <p className="text-muted-foreground">
          Enter your email to receive a sign-in link
        </p>
      </div>

      <Card className="border shadow-xl">
        <CardContent className="pt-6">
          <div className="grid gap-6">
            {/* Primary: Magic link form */}
            {!magicLinkSuccess && (
              <form action={magicLinkAction} className="grid gap-4">
                <input type="hidden" name="next" value={nextUrl} />
                <div className="grid gap-2">
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
                  className="w-full font-semibold"
                  disabled={isBusy}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {magicLinkPending ? 'Sending...' : 'Send magic link'}
                </Button>

                {magicLinkState?.error && (
                  <div className="p-3 rounded-md text-sm text-center font-medium bg-destructive/10 text-destructive">
                    {magicLinkState.error}
                  </div>
                )}
              </form>
            )}

            {/* Magic link sent success */}
            {magicLinkSuccess && (
              <div className="p-4 rounded-md text-sm text-center font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                <p className="font-semibold mb-1">Check your email</p>
                <p className="text-emerald-600 dark:text-emerald-300">
                  We sent a magic link to your email address. Click the link to
                  sign in.
                </p>
              </div>
            )}

            {/* Password fallback toggle */}
            {!showPassword && !magicLinkSuccess && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowPassword(true)}
                  className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                >
                  Use password instead
                </button>
              </div>
            )}

            {/* Hidden password form (D-04) */}
            {showPassword && !magicLinkSuccess && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-muted-foreground/20" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Or sign in with password
                    </span>
                  </div>
                </div>

                <form action={passwordAction} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="password-email">Email</Label>
                    <Input
                      id="password-email"
                      name="email"
                      type="email"
                      placeholder="you@yourvenue.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="grid gap-2">
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
                    variant="outline"
                    className="w-full"
                    disabled={isBusy}
                  >
                    {passwordPending ? 'Signing in...' : 'Sign in'}
                  </Button>

                  {passwordState?.error && (
                    <div className="p-3 rounded-md text-sm text-center font-medium bg-destructive/10 text-destructive">
                      {passwordState.error}
                    </div>
                  )}
                </form>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <a
          href="mailto:peter@orangejelly.co.uk"
          className="font-semibold hover:underline"
        >
          Contact support
        </a>
      </p>
    </div>
  );
}
