import { PlannerCalendar } from "@/features/planner/planner-calendar";
import { STATUS_QUERY_ALIASES, type PlannerStatusFilterValue } from "@/features/planner/status-filter-options";

interface PlannerPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const monthValueParam = resolvedParams?.month;
  const monthValue = Array.isArray(monthValueParam) ? monthValueParam[0] : monthValueParam;
  const statusParam = resolvedParams?.status;

  const statusFiltersSet = new Set<PlannerStatusFilterValue>();
  const collectStatusValues = (value: string | undefined) => {
    if (!value) return;
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .some((entry) => {
        const mapped = STATUS_QUERY_ALIASES[entry];
        if (mapped) {
          statusFiltersSet.add(mapped);
          return true;
        }
        return false;
      });
  };

  if (Array.isArray(statusParam)) {
    statusParam.some((entry) => {
      collectStatusValues(entry);
      return statusFiltersSet.size > 0;
    });
  } else if (typeof statusParam === "string") {
    collectStatusValues(statusParam);
  }

  const statusFilters = Array.from(statusFiltersSet);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Planner</h2>
        <p className="mt-2 text-sm text-white/80">Review and adjust your scheduled content at a glance.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/90 p-4 text-brand-teal shadow-lg">
        <PlannerCalendar
          month={typeof monthValue === "string" ? monthValue : undefined}
          statusFilters={statusFilters}
        />
      </section>
    </div>
  );
}
