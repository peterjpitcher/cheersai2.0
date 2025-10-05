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
  const firstName = user.displayName?.split(" ")[0] ?? "there";

  return (
    <div className="min-h-screen bg-brand-mist/15">
      <div className="mx-auto flex min-h-screen w-full flex-col gap-8 px-4 pb-16 pt-10 sm:px-8 xl:px-12">
        <section className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <article className="flex h-full flex-col justify-between gap-6 rounded-3xl border border-brand-teal/50 bg-brand-teal px-6 py-7 text-white shadow-2xl">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/75">CheersAI</p>
                <h1 className="text-3xl font-semibold">Command Centre</h1>
                <p className="max-w-xl text-sm text-white/85">
                  Generate, schedule, and monitor posts across Facebook, Instagram, and Google without leaving your hub.
                </p>
              </div>
              <div className="grid gap-4 text-sm text-white/80 md:grid-cols-2">
                <p className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                  <span className="text-white/90">{user.displayName}</span>
                  <span className="text-white/60">· {user.email}</span>
                </p>
                <p className="flex items-center justify-between gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                  <span>Timezone</span>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-teal">
                    {user.timezone}
                  </span>
                </p>
              </div>
            </article>
            <div className="grid gap-4">
              <article className="flex h-full flex-col justify-between gap-4 rounded-3xl border border-brand-ambergold/50 bg-brand-ambergold px-5 py-5 text-brand-sandstone shadow-xl">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-sandstone/70">Owner snapshot</p>
                  <h2 className="text-2xl font-semibold text-brand-sandstone">Welcome back, {firstName}.</h2>
                  <p className="text-sm text-brand-sandstone/75">
                    Review highlights from the last 24 hours before you dive into today’s scheduling.
                  </p>
                </div>
                <ul className="space-y-2 text-sm text-brand-sandstone/80">
                  <li className="rounded-2xl border border-brand-sandstone/30 bg-white/30 px-4 py-2 font-medium">
                    Publishing feed tracks every post and alert in real time.
                  </li>
                  <li className="rounded-2xl border border-brand-sandstone/30 bg-white/30 px-4 py-2 font-medium">
                    Rebuild queue runs hourly to materialise upcoming campaigns.
                  </li>
                </ul>
              </article>
              <article className="flex h-full flex-col justify-between gap-4 rounded-3xl border border-brand-oat/60 bg-brand-oat px-5 py-5 text-brand-sandstone shadow-xl">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-sandstone/70">Live status</p>
                  <h3 className="text-xl font-semibold text-brand-sandstone">Publishing updates & retries</h3>
                  <p className="text-sm text-brand-sandstone/70">
                    Open the activity drawer to see what just published, what’s queued next, and any provider issues that need
                    attention.
                  </p>
                </div>
                <div>
                  <StatusDrawer
                    variant="light"
                    feed={
                      <Suspense fallback={<div className="p-6 text-sm text-brand-sandstone">Loading activity…</div>}>
                        <PlannerActivityFeed />
                      </Suspense>
                    }
                  />
                </div>
              </article>
            </div>
          </div>
          <article className="rounded-3xl border border-brand-caramel/60 bg-brand-caramel/95 px-6 py-6 text-white shadow-[0_25px_80px_-35px_rgba(63,111,116,0.6)]">
            <header className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">Navigate</p>
                <h2 className="text-lg font-semibold text-white">Jump to the workspace you need</h2>
              </div>
              <p className="max-w-md text-sm text-white/75">
                Each space is colour coded so you always know where you are: teal for planning, caramel for creation, oat for
                the media library, sandstone for connections, and mist for settings.
              </p>
            </header>
            <AppNav />
          </article>
        </section>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
