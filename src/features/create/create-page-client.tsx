"use client";

import { useEffect, useState } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerOverview } from "@/lib/planner/data";
import { EventCampaignForm } from "@/features/create/event-campaign-form";
import { InstantPostForm } from "@/features/create/instant-post-form";
import { PromotionCampaignForm } from "@/features/create/promotion-campaign-form";
import { WeeklyCampaignForm } from "@/features/create/weekly-campaign-form";

const TABS = [
  { id: "instant", label: "Instant post" },
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
    <div className="space-y-8">
      <header className="rounded-2xl bg-brand-caramel px-6 py-5 text-white shadow-md">
        <h2 className="text-3xl font-semibold">Create</h2>
        <p className="mt-2 text-sm text-white/80">
          Launch instant posts, major events, limited-time promotions, and recurring weekly content.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              activeTab === tab.id
                ? "border-brand-caramel bg-brand-caramel text-white shadow-sm"
                : "border-brand-caramel/40 text-brand-caramel hover:border-brand-caramel/70 hover:text-brand-caramel"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="rounded-2xl border border-brand-caramel/30 bg-white p-6 shadow-lg">
        {activeTab === "instant" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-brand-caramel">Instant post</h3>
              <p className="text-sm text-brand-caramel/70">
                Tell CheersAI what you need and we’ll generate platform-specific copy right away. Schedule it or publish instantly.
              </p>
            </div>
            <InstantPostForm mediaLibrary={library} onLibraryUpdate={setLibrary} ownerTimezone={ownerTimezone} />
          </div>
        ) : null}

        {activeTab === "event" ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold text-brand-caramel">Event campaign</h3>
                <p className="text-sm text-brand-caramel/70">
                  Generate a default timeline (save the date, reminder, day-of hype) and we’ll schedule platform-specific posts automatically.
                </p>
              </div>
            <EventCampaignForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </div>
        ) : null}

        {activeTab === "promotion" ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold text-brand-caramel">Promotion</h3>
                <p className="text-sm text-brand-caramel/70">
                  Define an offer window and we’ll create launch, mid-run, and last-chance posts tailored to each platform.
                </p>
              </div>
            <PromotionCampaignForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </div>
        ) : null}

        {activeTab === "weekly" ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold text-brand-caramel">Weekly recurring</h3>
                <p className="text-sm text-brand-caramel/70">
                  Lock in a weekly drumbeat — we’ll schedule the next few occurrences with varied copy per slot.
                </p>
              </div>
            <WeeklyCampaignForm
              mediaLibrary={library}
              plannerItems={plannerItems}
              onLibraryUpdate={setLibrary}
              ownerTimezone={ownerTimezone}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
