'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MOBILE_NAV_ITEMS, isNavActive } from '@/config/app-nav';
import { cn } from '@/lib/utils';

/**
 * 44px mobile bottom navigation bar with 4 items and a raised Create FAB.
 * Fixed at viewport bottom, z-40, white background with top border.
 * Create button is a 48px orange circle raised 12px above the bar.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-[44px] items-center justify-around bg-white"
      style={{ borderTop: '1px solid var(--c-line)' }}
      aria-label="Mobile navigation"
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const active = isNavActive(item.href, pathname);

        // Raised Create FAB
        if (item.primary) {
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-label="Create"
              className={cn(
                'flex h-12 w-12 -mt-3 items-center justify-center rounded-full shadow-md',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
              )}
              style={{ background: 'var(--c-orange)' }}
            >
              <Plus size={22} strokeWidth={2.5} className="text-white" />
            </Link>
          );
        }

        // Standard nav item: icon + 9px label, stacked
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center px-2',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
            )}
            style={{ color: active ? 'var(--c-orange)' : 'var(--c-ink-3)' }}
          >
            <item.icon size={18} strokeWidth={active ? 2.5 : 2} />
            <span
              className={cn(
                'mt-0.5 leading-tight',
                active ? 'font-semibold' : 'font-medium',
              )}
              style={{ fontSize: '9px' }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
