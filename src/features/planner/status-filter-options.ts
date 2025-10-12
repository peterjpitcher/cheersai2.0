import type { PlannerOverview } from "@/lib/planner/data";

export type PlannerItemStatus = PlannerOverview["items"][number]["status"];

export type PlannerStatusFilterValue = "draft" | "scheduled" | "failed" | "completed";

export const STATUS_FILTER_OPTIONS: Array<{
  value: PlannerStatusFilterValue;
  label: string;
  status: PlannerItemStatus;
}> = [
  { value: "draft", label: "Draft", status: "draft" },
  { value: "scheduled", label: "Scheduled", status: "scheduled" },
  { value: "failed", label: "Failed", status: "failed" },
  { value: "completed", label: "Completed", status: "posted" },
];

export const STATUS_FILTER_VALUE_TO_STATUS = STATUS_FILTER_OPTIONS.reduce<Record<PlannerStatusFilterValue, PlannerItemStatus>>(
  (accumulator, option) => {
    accumulator[option.value] = option.status;
    return accumulator;
  },
  {} as Record<PlannerStatusFilterValue, PlannerItemStatus>,
);

export const STATUS_QUERY_ALIASES: Record<string, PlannerStatusFilterValue> = {
  draft: "draft",
  drafts: "draft",
  scheduled: "scheduled",
  schedule: "scheduled",
  failed: "failed",
  failure: "failed",
  filed: "failed",
  error: "failed",
  completed: "completed",
  complete: "completed",
  posted: "completed",
  publish: "completed",
};
