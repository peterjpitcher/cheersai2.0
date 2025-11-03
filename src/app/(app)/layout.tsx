import { ReactNode } from "react";

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
      <div className="min-h-screen bg-brand-mist text-brand-teal">
        <div className="mx-auto flex min-h-screen w-full flex-col gap-6 px-4 pb-12 pt-8 sm:px-8 xl:px-12">
          <header className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-brand-teal px-5 py-4 text-white shadow-lg lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/70">CheersAI Command Centre</p>
              <h1 className="text-xl font-semibold text-white">Welcome back, {firstName}.</h1>
              <p className="text-sm text-white/75">
                Generate, schedule, and monitor posts without leaving your workspace. Live status lives in the drawer on the right.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <StatusDrawer feed={<PlannerActivityFeed />} />
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
