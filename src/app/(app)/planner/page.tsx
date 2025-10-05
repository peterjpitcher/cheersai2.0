import { PlannerCalendar } from "@/features/planner/planner-calendar";

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const monthValueParam = resolvedParams?.month;
  const monthValue = Array.isArray(monthValueParam) ? monthValueParam[0] : monthValueParam;

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-brand-teal px-6 py-5 text-white shadow-md">
        <h2 className="text-3xl font-semibold">Planner</h2>
        <p className="mt-2 text-sm text-white/80">
          Review upcoming posts, monitor publishing status, and launch new campaigns without leaving this view.
        </p>
        <p className="text-xs text-white/70">
          Live publish activity now sits in the Command Centre drawer beside the status button.
        </p>
      </header>
      <section className="rounded-2xl border border-brand-teal/30 bg-white p-4 shadow-sm">
        <PlannerCalendar month={typeof monthValue === "string" ? monthValue : undefined} />
      </section>
    </div>
  );
}
