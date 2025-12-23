"use client";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerOverview } from "@/lib/planner/data";
import { CreateWizard } from "@/features/create/create-wizard";

interface CreatePageClientProps {
  mediaAssets: MediaAssetSummary[];
  plannerItems: PlannerOverview["items"];
  ownerTimezone: string;
  initialTab?: string;
}

export function CreatePageClient({ mediaAssets, plannerItems, ownerTimezone, initialTab }: CreatePageClientProps) {
  return (
    <CreateWizard
      mediaAssets={mediaAssets}
      plannerItems={plannerItems}
      ownerTimezone={ownerTimezone}
      initialTab={initialTab}
    />
  );
}
