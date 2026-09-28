'use client';

import { useEffect, useRef } from 'react';

import type { TurnstileWidgetFailure } from '@/lib/signup/turnstile-errors';

// Cloudflare Turnstile, rendered explicitly so it works after client-side
// navigation too. The widget adds a hidden `cf-turnstile-response` field to the
// enclosing form; the server checks it with siteverify (src/lib/signup/turnstile.ts).
// CSP: challenges.cloudflare.com is allowed in script-src and frame-src
// (src/lib/security/headers.ts).

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start')));
    script.onerror = () => reject(new Error('Turnstile could not load'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptPromise = null; // let a later attempt try again
    throw error;
  });
  return scriptPromise;
}

/** How long Cloudflare's script may take to load and show the widget before we give up. */
export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;

interface TurnstileWidgetProps {
  siteKey: string;
  action: string;
  /** A token is ready (true) or has expired or been used (false). */
  onReadyChange: (ready: boolean) => void;
  /** The widget could not load or could not run; `code` is Cloudflare's error code, when it gives one. */
  onError: (reason: TurnstileWidgetFailure, code?: string) => void;
}

export function TurnstileWidget({ siteKey, action, onReadyChange, onError }: TurnstileWidgetProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without re-rendering the widget when they change.
  const callbacks = useRef({ onReadyChange, onError });
  useEffect(() => {
    callbacks.current = { onReadyChange, onError };
  }, [onReadyChange, onError]);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    let rendered = false;
    const fail = (reason: TurnstileWidgetFailure, code?: string): void => {
      if (cancelled) return;
      callbacks.current.onReadyChange(false);
      callbacks.current.onError(reason, code);
    };
    // A script that never loads (blocked, or Cloudflare down) calls nothing, so time it out.
    const timer = window.setTimeout(() => {
      if (!rendered) fail('script_timeout');
    }, TURNSTILE_LOAD_TIMEOUT_MS);

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        try {
          widgetId = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action,
            theme: 'light',
            'response-field-name': 'cf-turnstile-response',
            callback: () => callbacks.current.onReadyChange(true),
            'expired-callback': () => callbacks.current.onReadyChange(false),
            'timeout-callback': () => callbacks.current.onReadyChange(false),
            'error-callback': (code?: unknown) => fail('widget_error', typeof code === 'string' ? code : undefined),
          });
          rendered = true;
          window.clearTimeout(timer);
        } catch {
          // Turnstile refused our parameters (for example a missing site key).
          window.clearTimeout(timer);
          fail('render_failed');
        }
      })
      .catch(() => {
        window.clearTimeout(timer);
        fail('script_load_failed');
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action]);

  return <div ref={containerRef} className="flex min-h-[65px] justify-center" />;
}
