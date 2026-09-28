'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { AuthMessage } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CONTACT } from '@/lib/legal/company';

import { requestSignup, type SignupRequestResult } from './actions';
import { TurnstileWidget } from './turnstile-widget';

/** "Send it again" waits this long after each send (spec §4.2 step 6). */
const RESEND_WAIT_SECONDS = 60;
const TURNSTILE_ACTION = 'signup';

interface SignupFormProps {
  siteKey: string;
  /** On a Vercel Preview the form is shown for review, but the server refuses every request. */
  preview: boolean;
}

interface FormState extends SignupRequestResult {
  email?: string;
}

/**
 * The sign-up request form and the "Check your email" screen. Every accepted
 * request shows the same screen, whatever the email, so the form never reveals
 * who has a login. The email stays in this component's state, never in the URL.
 */
export function SignupForm({ siteKey, preview }: SignupFormProps) {
  const [view, setView] = useState<'form' | 'sent'>('form');
  const [submissions, setSubmissions] = useState(0);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [tokenReady, setTokenReady] = useState(false);
  const [widgetFailed, setWidgetFailed] = useState(false);

  const [state, formAction, pending] = useActionState(async (_previous: FormState | null, formData: FormData): Promise<FormState> => {
    const email = String(formData.get('email') ?? '').trim();
    const result = await requestSignup(formData);
    // Each Turnstile answer works once: a fresh widget for the next attempt.
    setSubmissions((count) => count + 1);
    setTokenReady(false);
    if (result.success) {
      setView('sent');
      setSentAt(Date.now());
      setSecondsLeft(RESEND_WAIT_SECONDS);
    }
    // Kept so the field is filled in again after an error (React resets the form after each action).
    return { ...result, email };
  }, null);

  useEffect(() => {
    if (sentAt === null) return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, RESEND_WAIT_SECONDS - Math.floor((Date.now() - sentAt) / 1000));
      setSecondsLeft(left);
      if (left === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sentAt]);

  const onReadyChange = useCallback((ready: boolean) => setTokenReady(ready), []);
  const onWidgetError = useCallback(() => setWidgetFailed(true), []);

  const widget = (
    <>
      <TurnstileWidget
        key={submissions}
        siteKey={siteKey}
        action={TURNSTILE_ACTION}
        onReadyChange={onReadyChange}
        onError={onWidgetError}
      />
      {widgetFailed && !tokenReady && (
        <AuthMessage tone="error">
          The security check could not load. Please refresh the page, or email {CONTACT.email}.
        </AuthMessage>
      )}
      <noscript>
        <AuthMessage tone="error">Sign-up needs JavaScript for its security check. Turn it on, or email {CONTACT.email}.</AuthMessage>
      </noscript>
    </>
  );

  if (view === 'sent' && state?.email) {
    return (
      <div className="space-y-4">
        <AuthMessage tone="success">
          Check your inbox at {state.email} for a message from Cheers with the next step. It can take a few minutes;
          check your spam folder too.
        </AuthMessage>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="email" value={state.email} />
          {secondsLeft > 0 ? (
            <p className="text-center text-sm" style={{ color: 'var(--c-ink-3)' }} aria-live="polite">
              Nothing yet? You can send it again in {secondsLeft} {secondsLeft === 1 ? 'second' : 'seconds'}.
            </p>
          ) : (
            widget
          )}
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            full
            disabled={pending || secondsLeft > 0 || !tokenReady}
          >
            {pending ? 'Sending...' : 'Send it again'}
          </Button>
          {state.error && <AuthMessage tone="error">{state.error}</AuthMessage>}
        </form>
        <p className="text-center text-sm">
          <button
            type="button"
            className="underline"
            style={{ color: 'var(--c-ink-3)' }}
            onClick={() => {
              setView('form');
              setSentAt(null);
            }}
          >
            Use a different email address
          </button>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {preview && (
        <AuthMessage tone="error">
          This is a preview deployment: the form is here to be looked at, and every request is refused.
        </AuthMessage>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Your work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@yourvenue.com"
          required
          maxLength={254}
          autoComplete="email"
          autoFocus
          defaultValue={state?.email ?? ''}
        />
      </div>
      {widget}
      <Button type="submit" variant="primary" size="lg" full disabled={pending || !tokenReady}>
        {pending ? 'Sending...' : 'Email me a link'}
      </Button>
      {state?.error && <AuthMessage tone="error">{state.error}</AuthMessage>}
      <p className="text-center text-sm" style={{ color: 'var(--c-ink-3)' }}>
        Already have a login?{' '}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
