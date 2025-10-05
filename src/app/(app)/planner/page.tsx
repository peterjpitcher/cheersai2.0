import { PlannerCalendar } from "@/features/planner/planner-calendar";

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const monthValueParam = resolvedParams?.month;
  const monthValue = Array.isArray(monthValueParam) ? monthValueParam[0] : monthValueParam;

  return (
    <div className="space-y-8 rounded-3xl border border-brand-teal/30 bg-brand-teal/5 p-8 shadow-lg">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-brand-teal">Planner</h2>
        <p className="text-sm text-brand-teal/70">
          Review upcoming posts, monitor publishing status, and launch new campaigns without leaving this view.
        </p>
        <p className="text-xs text-brand-teal/60">
          Live publish activity now sits in the Command Centre drawer, next to your timezone badge.
        </p>
      </header>
      <section className="rounded-2xl border border-brand-teal/20 bg-white p-4 shadow-sm">
        <PlannerCalendar month={typeof monthValue === "string" ? monthValue : undefined} />
      </section>
    </div>
  );
}
