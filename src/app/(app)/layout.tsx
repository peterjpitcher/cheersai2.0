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
      <div className="min-h-screen bg-brand-mist/15">
        <div className="mx-auto flex min-h-screen w-full flex-col gap-6 px-4 pb-12 pt-10 sm:px-8 xl:px-12">
          <section className="grid gap-4 md:grid-cols-3">
            <article className="space-y-3 rounded-2xl border border-brand-teal/40 bg-brand-teal px-5 py-5 text-white shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/70">CheersAI</p>
              <h1 className="text-2xl font-semibold">Command Centre</h1>
              <p className="text-sm text-white/80">
                Generate, schedule, and monitor posts across Facebook, Instagram, and Google without leaving your hub.
              </p>
            </article>
            <article className="space-y-4 rounded-2xl border border-brand-ambergold/40 bg-brand-ambergold px-5 py-5 text-white shadow-lg">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/75">Daily snapshot</p>
                  <h2 className="text-xl font-semibold">Welcome back, {firstName}.</h2>
                </div>
                <SignOutForm />
              </header>
              <ul className="space-y-2 text-sm text-white/85">
                <li className="rounded-xl border border-white/30 bg-white/15 px-4 py-2">
                  Publishing feed tracks every post and alert in real time.
                </li>
                <li className="rounded-xl border border-white/30 bg-white/15 px-4 py-2">
                  Rebuild worker materialises scheduled campaigns on the hour.
                </li>
              </ul>
            </article>
            <article className="flex flex-col justify-between gap-4 rounded-2xl border border-brand-oat/40 bg-brand-oat px-5 py-5 text-white shadow-lg">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/75">Live status</p>
                <h3 className="text-xl font-semibold">Publishing updates & retries</h3>
                <p className="text-sm text-white/80">
                  Open the activity drawer to review what just published, what’s queued next, and any provider issues.
                </p>
              </div>
              <StatusDrawer
                feed={
                  <Suspense fallback={<div className="p-6 text-sm text-white/80">Loading activity…</div>}>
                    <PlannerActivityFeed />
                  </Suspense>
                }
              />
            </article>
          </section>
          <section className="rounded-2xl border border-brand-caramel/40 bg-brand-caramel px-5 py-5 text-white shadow-[0_18px_60px_-30px_rgba(63,111,116,0.6)]">
            <header className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">Navigate</p>
                <h2 className="text-lg font-semibold">Jump to the workspace you need</h2>
              </div>
              <p className="max-w-md text-sm text-white/75">
                Each space is colour coded: teal for planning, caramel for creation, oat for the media library, sandstone for
                connections, and mist for settings.
              </p>
            </header>
            <AppNav />
          </section>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
