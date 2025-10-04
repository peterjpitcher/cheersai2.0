"use client";

import { useState } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";
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
  initialTab?: string;
}

export function CreatePageClient({ mediaAssets, initialTab }: CreatePageClientProps) {
  const validatedInitialTab = initialTab && TABS.some((tab) => tab.id === initialTab) ? initialTab : "instant";
  const [activeTab, setActiveTab] = useState<string>(validatedInitialTab);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-slate-900">Create</h2>
        <p className="text-slate-600">
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
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 text-slate-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {activeTab === "instant" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-slate-900">Instant post</h3>
              <p className="text-sm text-slate-500">
                Tell CheersAI what you need and we’ll generate platform-specific copy right away. Schedule it or publish instantly.
              </p>
            </div>
            <InstantPostForm mediaLibrary={mediaAssets} />
          </div>
        ) : null}

        {activeTab === "event" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-slate-900">Event campaign</h3>
              <p className="text-sm text-slate-500">
                Generate a default timeline (save the date, reminder, day-of hype) and we’ll schedule platform-specific posts automatically.
              </p>
            </div>
            <EventCampaignForm mediaLibrary={mediaAssets} />
          </div>
        ) : null}

        {activeTab === "promotion" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-slate-900">Promotion</h3>
              <p className="text-sm text-slate-500">
                Define an offer window and we’ll create launch, mid-run, and last-chance posts tailored to each platform.
              </p>
            </div>
            <PromotionCampaignForm mediaLibrary={mediaAssets} />
          </div>
        ) : null}

        {activeTab === "weekly" ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-slate-900">Weekly recurring</h3>
              <p className="text-sm text-slate-500">
                Lock in a weekly drumbeat — we’ll schedule the next few occurrences with varied copy per slot.
              </p>
            </div>
            <WeeklyCampaignForm mediaLibrary={mediaAssets} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
