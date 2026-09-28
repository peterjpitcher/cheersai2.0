'use client';

import { useEffect, useRef } from 'react';

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

interface TurnstileWidgetProps {
  siteKey: string;
  action: string;
  /** A token is ready (true) or has expired or been used (false). */
  onReadyChange: (ready: boolean) => void;
  /** The widget could not load or could not run. */
  onError: () => void;
}

export function TurnstileWidget({ siteKey, action, onReadyChange, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without re-rendering the widget when they change.
  const callbacks = useRef({ onReadyChange, onError });
  useEffect(() => {
    callbacks.current = { onReadyChange, onError };
  }, [onReadyChange, onError]);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'light',
          'response-field-name': 'cf-turnstile-response',
          callback: () => callbacks.current.onReadyChange(true),
          'expired-callback': () => callbacks.current.onReadyChange(false),
          'timeout-callback': () => callbacks.current.onReadyChange(false),
          'error-callback': () => {
            callbacks.current.onReadyChange(false);
            callbacks.current.onError();
          },
        });
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onError();
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action]);

  return <div ref={containerRef} className="flex min-h-[65px] justify-center" />;
}
