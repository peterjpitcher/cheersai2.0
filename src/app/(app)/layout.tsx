import { ReactNode } from "react";

import { AppNav } from "@/components/layout/app-nav";
import { getCurrentUser } from "@/lib/auth/server";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-8 px-6 py-10">
      <aside className="hidden w-80 shrink-0 lg:block">
        <div className="sticky top-10 flex flex-col gap-6">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">CheersAI</p>
            <h1 className="text-2xl font-semibold text-slate-900">Command Centre</h1>
            <p className="mt-2 text-sm text-slate-500">
              Generate, schedule, and monitor posts across Facebook, Instagram, and Google.
            </p>
          </div>
          <AppNav />
        </div>
      </aside>
      <main className="flex-1 pb-16">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="lg:hidden">
            <p className="text-xs font-semibold uppercase text-slate-500">CheersAI</p>
            <h1 className="text-2xl font-semibold text-slate-900">Command Centre</h1>
            <p className="mt-1 text-sm text-slate-600">
              Generate, schedule, and monitor posts across Facebook, Instagram, and Google.
            </p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-900">{user.displayName}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <div className="rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600">
              Timezone: {user.timezone}
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
