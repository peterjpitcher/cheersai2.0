"use client";

import { useEffect, useState } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerOverview } from "@/lib/planner/data";
import { EventCampaignForm } from "@/features/create/event-campaign-form";
import { InstantPostForm } from "@/features/create/instant-post-form";
import { PromotionCampaignForm } from "@/features/create/promotion-campaign-form";
import { StorySeriesForm } from "@/features/create/story-series-form";
import { WeeklyCampaignForm } from "@/features/create/weekly-campaign-form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { id: "instant", label: "Instant post" },
  { id: "stories", label: "Stories" },
  { id: "event", label: "Event campaign" },
  { id: "promotion", label: "Promotion" },
  { id: "weekly", label: "Weekly recurring" },
];

interface CreatePageClientProps {
  mediaAssets: MediaAssetSummary[];
  plannerItems: PlannerOverview["items"];
  ownerTimezone: string;
  initialTab?: string;
}

export function CreatePageClient({ mediaAssets, plannerItems, ownerTimezone, initialTab }: CreatePageClientProps) {
  const validatedInitialTab = initialTab && TABS.some((tab) => tab.id === initialTab) ? initialTab : "instant";
  const [activeTab, setActiveTab] = useState<string>(validatedInitialTab);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaAssets);

  useEffect(() => {
    setLibrary(mediaAssets);
  }, [mediaAssets]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Create</h2>
        <p className="mt-2 text-sm text-white/80">
          Launch instant posts, story drops, major events, limited-time promotions, and recurring weekly content.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full block h-auto bg-transparent p-0">
          <TabsList className="flex flex-wrap justify-start gap-2 bg-transparent h-auto p-0 mb-6">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="rounded-full border border-brand-navy bg-white text-brand-navy data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-md shadow-sm transition-all px-4 py-2"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="instant" className="space-y-6 mt-0">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold">Instant post</h3>
              <p className="text-sm text-brand-teal/70">
                Tell CheersAI what you need and we’ll generate platform-specific copy right away. Schedule it or publish instantly.
              </p>
            </div>
            <InstantPostForm mediaLibrary={library} onLibraryUpdate={setLibrary} ownerTimezone={ownerTimezone} />
          </TabsContent>

          <TabsContent value="stories" className="space-y-6 mt-0">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold">Story lineup</h3>
              <p className="text-sm text-brand-teal/70">
                Choose exact dates for Facebook and Instagram stories, attach the visuals, and queue them in one run.
              </p>
            </div>
            <StorySeriesForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </TabsContent>

          <TabsContent value="event" className="space-y-6 mt-0">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold">Event campaign</h3>
              <p className="text-sm text-brand-teal/70">
                Generate a default timeline (save the date, reminder, day-of hype) and we’ll schedule platform-specific posts automatically.
              </p>
            </div>
            <EventCampaignForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </TabsContent>

          <TabsContent value="promotion" className="space-y-6 mt-0">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold">Promotion</h3>
              <p className="text-sm text-brand-teal/70">
                Define an offer window and we’ll create launch, mid-run, and last-chance posts tailored to each platform.
              </p>
            </div>
            <PromotionCampaignForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </TabsContent>

          <TabsContent value="weekly" className="space-y-6 mt-0">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold">Weekly recurring</h3>
              <p className="text-sm text-brand-teal/70">
                Lock in a weekly drumbeat — we’ll schedule the next few occurrences with varied copy per slot.
              </p>
            </div>
            <WeeklyCampaignForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
