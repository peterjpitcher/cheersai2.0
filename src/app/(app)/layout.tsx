import { ReactNode, Suspense } from "react";

import { SignOutForm } from "@/components/auth/sign-out-form";
import { AppNav } from "@/components/layout/app-nav";
import { StatusDrawer } from "@/components/layout/status-drawer";
import { AuthProvider } from "@/components/providers/auth-provider";
import { PlannerActivityFeed } from "@/features/planner/activity-feed";
import { getCurrentUser } from "@/lib/auth/server";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();
  const firstName = user.displayName?.split(" ")[0] ?? "there";

  return (
    <AuthProvider value={user}>
      <div className="min-h-screen bg-brand-mist/10">
        <div className="mx-auto flex min-h-screen w-full flex-col gap-6 px-4 pb-12 pt-8 sm:px-8 xl:px-12">
          <header className="flex flex-col gap-3 rounded-2xl border border-brand-teal/30 bg-white/90 px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-brand-teal/70">CheersAI Command Centre</p>
              <h1 className="text-xl font-semibold text-brand-teal">Welcome back, {firstName}.</h1>
              <p className="text-sm text-brand-teal/70">
                Generate, schedule, and monitor posts without leaving your workspace. Live status lives in the drawer on the right.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <StatusDrawer
                feed={
                  <Suspense fallback={<div className="px-4 py-3 text-xs text-brand-teal/70">Loading recent activity…</div>}>
                    <PlannerActivityFeed />
                  </Suspense>
                }
              />
              <SignOutForm />
            </div>
          </header>
          <AppNav />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
