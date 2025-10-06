import { PlannerCalendar } from "@/features/planner/planner-calendar";

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const monthValueParam = resolvedParams?.month;
  const monthValue = Array.isArray(monthValueParam) ? monthValueParam[0] : monthValueParam;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-brand-teal">Planner</h2>
        <p className="text-sm text-brand-teal/70">Review and adjust your scheduled content at a glance.</p>
      </header>
      <section className="rounded-2xl border border-brand-teal/20 bg-white p-4 shadow-sm">
        <PlannerCalendar month={typeof monthValue === "string" ? monthValue : undefined} />
      </section>
    </div>
  );
}
