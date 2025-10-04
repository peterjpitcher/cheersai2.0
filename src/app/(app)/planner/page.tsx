import Link from "next/link";

import { PlannerActivityFeed } from "@/features/planner/activity-feed";
import { PlannerSchedule } from "@/features/planner/planner-schedule";

export default function PlannerPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-slate-900">Planner</h2>
        <p className="text-slate-600">
          Review upcoming posts, monitor publishing status, and launch new campaigns without leaving this view.
        </p>
      </header>
      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">This week</h3>
          <p className="text-sm text-slate-500">
            Scheduled content appears below as soon as campaigns are confirmed.
          </p>
          <div className="mt-4">
            <PlannerSchedule />
          </div>
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
