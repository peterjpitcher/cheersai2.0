import Link from "next/link";

import { PlannerActivityFeed } from "@/features/planner/activity-feed";
import { PlannerCalendar } from "@/features/planner/planner-calendar";

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const monthValueParam = resolvedParams?.month;
  const monthValue = Array.isArray(monthValueParam) ? monthValueParam[0] : monthValueParam;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-slate-900">Planner</h2>
        <p className="text-slate-600">
          Review upcoming posts, monitor publishing status, and launch new campaigns without leaving this view.
        </p>
      </header>
      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <PlannerCalendar month={typeof monthValue === "string" ? monthValue : undefined} />
        </div>
        <aside className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Status feed</h3>
            <p className="text-sm text-slate-500">
              Publishing activity, retries, and token alerts land here instantly.
            </p>
            <Link href="/planner/notifications" className="text-xs font-semibold text-slate-600 underline">
              View history
            </Link>
          </div>
          <PlannerActivityFeed />
        </aside>
      </section>
    </div>
  );
}
