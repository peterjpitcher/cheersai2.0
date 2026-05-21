'use client';

import { BottomNav } from '@/components/layout/bottom-nav';
import { TopRail } from '@/components/layout/top-rail';
import type { ConnectionHealthSummary } from '@/types/providers';

interface AppShellProps {
  children: React.ReactNode;
  healthSummaries?: ConnectionHealthSummary[];
  notificationCount?: number;
}

/**
 * Responsive application shell with top-rail navigation layout.
 *
 * - All viewports: TopRail sticky header (52px) with brand, nav (desktop), actions.
 * - Mobile (< 640px): BottomNav (44px) with 4 items + Create FAB.
 * - Desktop: full nav in TopRail, no bottom bar.
 *
 * TopRail is position: sticky so content flows naturally below it.
 */
export function AppShell({ children, healthSummaries = [], notificationCount = 0 }: AppShellProps) {
  return (
    <div className="min-h-screen bg-white font-sans" style={{ color: 'var(--c-ink)' }}>
      {/* Sticky top navigation */}
      <TopRail
        healthSummaries={healthSummaries}
        notificationCount={notificationCount}
      />

      {/* Main content -- bottom padding on mobile for BottomNav clearance */}
      <main className="w-full px-4 pt-6 pb-[44px] sm:px-6 sm:pb-0 lg:px-8 xl:px-12 2xl:px-16">
        {children}
      </main>

      {/* Bottom nav: mobile only */}
      <div className="sm:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
