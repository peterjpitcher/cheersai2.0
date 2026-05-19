'use client';

import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';

import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { NotificationRow } from '@/types/notifications';

interface NotificationBadgeProps {
  initialCount: number;
  accountId: string;
}

/**
 * Renders a BellRing icon with a red badge showing the unread notification count.
 * Count updates in realtime via Supabase Realtime subscriptions.
 * If count is 0, no badge is displayed (icon still renders).
 */
export function NotificationBadge({ initialCount, accountId }: NotificationBadgeProps) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel(`notif-badge:${accountId}`)
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow | undefined;
          // Only count if not already read/dismissed
          if (row && !row.read_at && !row.dismissed_at) {
            setCount((prev) => prev + 1);
          }
        },
      )
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const newRow = payload.new as NotificationRow | undefined;
          const oldRow = payload.old as Partial<NotificationRow> | undefined;

          // Decrement when a notification is marked as read or dismissed
          const wasUnread = !oldRow?.read_at && !oldRow?.dismissed_at;
          const isNowRead = !!newRow?.read_at || !!newRow?.dismissed_at;

          if (wasUnread && isNowRead) {
            setCount((prev) => Math.max(0, prev - 1));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return (
    <div className="relative">
      <BellRing className="h-5 w-5" />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </div>
  );
}
