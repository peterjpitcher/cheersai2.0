import { ReactNode, Suspense } from "react";

import { AppNav } from "@/components/layout/app-nav";
import { StatusDrawer } from "@/components/layout/status-drawer";
import { PlannerActivityFeed } from "@/features/planner/activity-feed";
import { getCurrentUser } from "@/lib/auth/server";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-brand-mist/20">
      <div className="mx-auto flex min-h-screen w-full flex-col gap-10 px-4 pb-16 pt-10 sm:px-8 xl:px-12">
        <section className="rounded-3xl bg-gradient-to-r from-brand-sandstone via-brand-caramel to-brand-teal px-6 py-8 text-white shadow-xl ring-1 ring-brand-sandstone/20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/80">CheersAI</p>
              <h1 className="text-3xl font-semibold">Command Centre</h1>
              <p className="max-w-xl text-sm text-white/90">
                Generate, schedule, and monitor posts across Facebook, Instagram, and Google without leaving your hub.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right text-sm">
                <p className="font-semibold text-white">{user.displayName}</p>
                <p className="text-white/80">{user.email}</p>
              </div>
              <div className="rounded-full border border-white/30 bg-white/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-sm backdrop-blur">
                Timezone: {user.timezone}
              </div>
              <StatusDrawer
                feed={
                  <Suspense fallback={<div className="p-6 text-sm text-brand-teal">Loading activity…</div>}>
                    <PlannerActivityFeed />
                  </Suspense>
                }
              />
            </div>
          </div>
          <div className="mt-6 overflow-x-auto pb-1">
            <AppNav />
          </div>
        </section>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
