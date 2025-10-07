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
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Planner</h2>
        <p className="mt-2 text-sm text-white/80">Review and adjust your scheduled content at a glance.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/90 p-4 text-brand-teal shadow-lg">
        <PlannerCalendar month={typeof monthValue === "string" ? monthValue : undefined} />
      </section>
    </div>
  );
}
