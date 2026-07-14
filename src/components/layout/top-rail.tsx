'use client';

import { Bell, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';

import { BrandSwitcher } from '@/components/layout/brand-switcher';
import { formatBadgeCount } from '@/components/layout/format-badge-count';
import { APP_NAV_ITEMS, isNavActive } from '@/config/app-nav';
import { cn } from '@/lib/utils';
import type { ConnectionHealthSummary } from '@/types/providers';

export { formatBadgeCount };

interface TopRailProps {
  healthSummaries?: ConnectionHealthSummary[];
  notificationCount?: number;
  signOutAction?: () => Promise<void>;
}

function TopRailSignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      aria-label={pending ? 'Signing out' : 'Sign out'}
      title={pending ? 'Signing out' : 'Sign out'}
      disabled={pending}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
      style={{
        border: '1px solid var(--c-line)',
        color: 'var(--c-ink-2)',
      }}
    >
      <LogOut size={14} />
    </button>
  );
}

/**
 * 52px sticky top navigation header.
 * Desktop: brand wordmark + 7 nav items + notification bell + venue chip.
 * Mobile (< 640px): brand wordmark + right-side actions only (nav hidden, BottomNav handles it).
 */
export function TopRail({ notificationCount = 0, signOutAction }: TopRailProps) {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-40 flex h-[52px] items-center justify-between border-b bg-white px-5"
      style={{ borderBottomColor: 'var(--c-line)' }}
    >
      {/* Left: Brand + Nav */}
      <div className="flex items-center gap-6">
        {/* Brand wordmark */}
        <Link href="/planner" className="flex items-center gap-2">
          <div
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px]"
            style={{ background: 'var(--c-orange)' }}
          >
            <span className="text-sm font-bold leading-none text-white">C</span>
          </div>
          <span
            className="text-lg font-semibold"
            style={{ color: 'var(--c-ink)' }}
          >
            CheersAI
          </span>
        </Link>

        {/* Desktop nav items -- hidden on mobile */}
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Main navigation">
          {APP_NAV_ITEMS.map((item) => {
            const active = isNavActive(item.href, pathname);

            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative rounded-[5px] px-2.5 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                  active
                    ? 'font-semibold'
                    : 'font-medium',
                )}
                style={{
                  background: active ? 'var(--c-paper-2)' : 'transparent',
                  color: active ? 'var(--c-ink)' : 'var(--c-ink-3)',
                }}
              >
                {item.label}
                {/* Orange underline for active item */}
                {active && (
                  <span
                    className="absolute left-2.5 right-2.5"
                    style={{
                      bottom: '-8px',
                      height: '2px',
                      background: 'var(--c-orange)',
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: Notifications + Venue chip */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <Link
          href="/planner/notifications"
          className={cn(
            'relative flex h-8 w-8 items-center justify-center rounded-md',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
          )}
          style={{
            border: '1px solid var(--c-line)',
            color: 'var(--c-ink-2)',
          }}
          aria-label={
            notificationCount > 0
              ? `Notifications (${notificationCount} unread)`
              : 'Notifications'
          }
        >
          <Bell size={14} />
          {notificationCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex items-center justify-center rounded-full text-white"
              style={{
                minWidth: '14px',
                height: '14px',
                fontSize: '9px',
                lineHeight: 1,
                padding: '0 3px',
                background: 'var(--c-orange)',
              }}
            >
              {formatBadgeCount(notificationCount)}
            </span>
          )}
        </Link>

        {/* Active-brand switcher */}
        <BrandSwitcher />

        {signOutAction ? (
          <form action={signOutAction}>
            <TopRailSignOutButton />
          </form>
        ) : null}
      </div>
    </header>
  );
}
