'use client';

import {
  Calendar,
  Image,
  LayoutDashboard,
  PlusCircle,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/** Bottom nav item configuration */
interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Whether this item is the primary action (Create) */
  primary?: boolean;
}

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Planner', href: '/planner', icon: Calendar },
  { label: 'Create', href: '/create', icon: PlusCircle, primary: true },
  { label: 'Library', href: '/library', icon: Image },
  { label: 'Settings', href: '/settings', icon: Settings },
];

/**
 * Bottom navigation bar for mobile viewports.
 * Fixed at 64px height with minimum 44x44px touch targets (UX-02, UX-05).
 * Center "Create" button is visually distinct with primary colour.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-border bg-background/95 backdrop-blur-sm"
      aria-label="Mobile navigation"
    >
      {BOTTOM_NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        if (item.primary) {
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex min-h-11 min-w-11 flex-col items-center justify-center rounded-full px-3 py-1',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                'bg-primary text-primary-foreground shadow-md -mt-3',
              )}
            >
              <item.icon size={22} strokeWidth={2.5} />
              <span className="mt-0.5 text-[10px] font-semibold leading-tight">
                {item.label}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex min-h-11 min-w-11 flex-col items-center justify-center px-3 py-1',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
              isActive
                ? 'text-primary'
                : 'text-muted-foreground',
            )}
          >
            <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
            <span
              className={cn(
                'mt-0.5 text-[10px] leading-tight',
                isActive ? 'font-semibold' : 'font-medium',
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
