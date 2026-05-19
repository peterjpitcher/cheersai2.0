'use client';

import { BottomNav } from '@/components/layout/bottom-nav';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import type { ConnectionHealthSummary } from '@/types/providers';

interface AppShellProps {
  children: React.ReactNode;
  healthSummaries?: ConnectionHealthSummary[];
}

/**
 * Responsive application shell providing the unified navigation layout (UX-09).
 *
 * - Mobile (< 640px): full-width content + BottomNav (64px fixed bottom bar)
 * - Tablet (640-1023px): SidebarNav collapsed (80px icon-only) + offset content
 * - Desktop (>= 1024px): SidebarNav expanded (260px with labels) + offset content
 *
 * Breakpoint detection via useBreakpoint hook with matchMedia listeners.
 */
export function AppShell({ children, healthSummaries = [] }: AppShellProps) {
  const { isMobile, isTablet, isDesktop } = useBreakpoint();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Sidebar: tablet (collapsed) or desktop (expanded) */}
      {isTablet && <SidebarNav collapsed healthSummaries={healthSummaries} />}
      {isDesktop && <SidebarNav collapsed={false} healthSummaries={healthSummaries} />}

      {/* Main content with padding to clear sidebar/bottom nav */}
      <main
        className={
          isMobile
            ? 'min-h-screen pb-16'
            : isTablet
              ? 'min-h-screen pl-20'
              : 'min-h-screen pl-[260px]'
        }
      >
        {children}
      </main>

      {/* Bottom nav: mobile only */}
      {isMobile && <BottomNav />}
    </div>
  );
}
