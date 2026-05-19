/**
 * Login toast for unhealthy connections (per D-03 design requirement).
 * Shows a warning toast once per session when any connection is amber or red.
 * Uses the project's custom ToastProvider via useToast() hook.
 */

'use client';

import { useEffect } from 'react';

import { useToast } from '@/components/providers/toast-provider';
import type { ConnectionHealthSummary } from '@/types/providers';

interface ConnectionHealthToastProps {
  summaries: ConnectionHealthSummary[];
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business Profile',
};

const SESSION_KEY = 'cheersai_connection_toast_shown';

/**
 * Renders nothing visually. On mount, checks for unhealthy connections
 * and shows a warning toast once per browser session (via sessionStorage).
 */
export function ConnectionHealthToast({ summaries }: ConnectionHealthToastProps): null {
  const toast = useToast();

  useEffect(() => {
    // One-time per session (per D-03)
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const unhealthy = summaries.filter(s => s.health === 'amber' || s.health === 'red');
    if (!unhealthy.length) return;

    sessionStorage.setItem(SESSION_KEY, 'true');

    // Show toast for each unhealthy connection (max 3)
    unhealthy.slice(0, 3).forEach(conn => {
      const label = PLATFORM_LABELS[conn.provider] ?? conn.provider;
      const title = conn.health === 'red'
        ? `${label} connection expired`
        : `${label} token expires soon`;

      toast.push(title, {
        tone: 'error',
        description: conn.health === 'red'
          ? 'Reconnect now to avoid publishing failures'
          : 'Reconnect soon to keep publishing working',
        durationMs: 8000,
        action: {
          label: 'Reconnect',
          onClick: () => { window.location.href = '/connections'; },
        },
      });
    });
  }, [summaries, toast]);

  return null;
}
