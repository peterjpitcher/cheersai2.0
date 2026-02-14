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

export interface CreateWizardProps {
    mediaAssets: MediaAssetSummary[];
    plannerItems: PlannerOverview["items"];
    ownerTimezone: string;
    initialTab?: string;
    initialDate?: Date;
    initialMedia?: MediaAssetSummary[];
    onSuccess?: () => void;
}

export function CreateWizard({
    mediaAssets,
    plannerItems,
    ownerTimezone,
    initialTab,
    initialDate,
    initialMedia,
    onSuccess
}: CreateWizardProps) {
    const validatedInitialTab = initialTab && TABS.some((tab) => tab.id === initialTab) ? initialTab : "instant";
    const [activeTab, setActiveTab] = useState<string>(validatedInitialTab);
    const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaAssets);

    useEffect(() => {
        setLibrary(mediaAssets);
    }, [mediaAssets]);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                    Pick a flow and we’ll guide you through assets, copy, and scheduling.
                </p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full block h-auto bg-transparent p-0">
                <TabsList className="flex flex-wrap justify-start gap-2 bg-transparent h-auto p-0 mb-6">
                    {TABS.map((tab) => (
                        <TabsTrigger
                            key={tab.id}
                            value={tab.id}
                            className="rounded-full border border-white/30 bg-white/70 px-4 py-2 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm transition-all data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                        >
                            {tab.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value="instant" className="space-y-6 mt-0">
                    <div className="space-y-2">
                        <h3 className="text-xl font-semibold text-foreground">Instant post</h3>
                        <p className="text-sm text-muted-foreground">
                            Tell CheersAI what you need and we’ll generate platform-specific copy right away. Schedule it or publish instantly.
                        </p>
                    </div>
                    <InstantPostForm
                        mediaLibrary={library}
                        onLibraryUpdate={setLibrary}
                        ownerTimezone={ownerTimezone}
                        initialDate={initialDate}
                        initialMedia={initialMedia}
                        onSuccess={onSuccess}
                    />
                </TabsContent>

                <TabsContent value="stories" className="space-y-6 mt-0">
                    <div className="space-y-2">
                        <h3 className="text-xl font-semibold text-foreground">Story lineup</h3>
                        <p className="text-sm text-muted-foreground">
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
                        <h3 className="text-xl font-semibold text-foreground">Event campaign</h3>
                        <p className="text-sm text-muted-foreground">
                            Generate a default timeline (save the date plus 3-day, 2-day, and 1-day reminders) and we’ll schedule platform-specific posts automatically.
                        </p>
                    </div>
                    <EventCampaignForm
                        mediaLibrary={library}
                        plannerItems={plannerItems}
                        onLibraryUpdate={setLibrary}
                        ownerTimezone={ownerTimezone}
                        initialDate={initialDate}
                        onSuccess={onSuccess}
                    />
                </TabsContent>

                <TabsContent value="promotion" className="space-y-6 mt-0">
                    <div className="space-y-2">
                        <h3 className="text-xl font-semibold text-foreground">Promotion</h3>
                        <p className="text-sm text-muted-foreground">
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
                        <h3 className="text-xl font-semibold text-foreground">Weekly recurring</h3>
                        <p className="text-sm text-muted-foreground">
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
        </div>
    );
}
