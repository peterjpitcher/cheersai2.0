'use client';

import {
  Calendar,
  Image,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PlusCircle,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ConnectionHealthDots } from '@/features/connections/health-dots';
import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import type { ConnectionHealthSummary } from '@/types/providers';

/** Navigation item configuration */
interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  /** Whether to render health dots after this item's label */
  showHealthDots?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Create', href: '/create', icon: PlusCircle },
  { label: 'Planner', href: '/planner', icon: Calendar },
  { label: 'Library', href: '/library', icon: Image },
  { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { label: 'Settings', href: '/settings', icon: Settings, showHealthDots: true },
];

interface SidebarNavProps {
  /** When true, renders 80px icon-only sidebar (tablet). When false, renders 260px expanded sidebar (desktop). */
  collapsed?: boolean;
  /** Connection health summaries for rendering health dots (D-01) */
  healthSummaries?: ConnectionHealthSummary[];
}

/**
 * Sidebar navigation for tablet (collapsed, 80px) and desktop (expanded, 260px).
 * Uses Radix Tooltip for icon-only mode hover labels.
 * All items are keyboard navigable with visible focus styles (UX-07).
 */
export function SidebarNav({ collapsed = false, healthSummaries = [] }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        style={{ width: collapsed ? 80 : 260 }}
        className="fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out"
      >
        {/* Logo / brand header */}
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
            <span className="font-heading text-sm font-bold leading-none">C</span>
          </div>
          {!collapsed && (
            <span className="ml-2 font-heading text-lg font-bold tracking-tight text-sidebar-foreground">
              CheersAI
            </span>
          )}
        </div>

        {/* Navigation items */}
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            const linkContent = (
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group flex items-center rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  collapsed && 'justify-center px-0',
                )}
              >
                <item.icon
                  size={20}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {!collapsed && (
                  <>
                    <span className="ml-3">{item.label}</span>
                    {item.showHealthDots && healthSummaries.length > 0 && (
                      <ConnectionHealthDots summaries={healthSummaries} />
                    )}
                  </>
                )}
              </Link>
            );

            // Wrap in tooltip when collapsed for hover labels
            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    <span className="inline-flex items-center gap-1">
                      {item.label}
                      {item.showHealthDots && healthSummaries.length > 0 && (
                        <ConnectionHealthDots summaries={healthSummaries} />
                      )}
                    </span>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return <div key={item.href}>{linkContent}</div>;
          })}
        </nav>

        {/* Sign out */}
        <div className="border-t border-sidebar-border p-3">
          <form action={signOut}>
            <SignOutButton collapsed={collapsed} />
          </form>
        </div>
      </aside>
    </TooltipProvider>
  );
}

/** Sign-out button with pending state */
function SignOutButton({ collapsed }: { collapsed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'flex w-full items-center rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors',
        'hover:bg-destructive/10 hover:text-destructive',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        collapsed && 'justify-center px-0',
      )}
    >
      <LogOut size={20} />
      {!collapsed && (
        <span className="ml-3">{pending ? 'Signing out...' : 'Sign out'}</span>
      )}
    </button>
  );
}
