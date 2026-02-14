// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { type SupabaseClient, createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildWeeklyCopy, clampDay, getFirstOccurrenceAfter, type WeeklyAdvancedOptions } from "./utils.ts";

export type ProviderPlatform = "facebook" | "instagram" | "gbp";
export type ContentStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed";

export interface WeeklyCampaignRow {
    id: string;
    account_id: string;
    name: string;
    auto_confirm: boolean;
    metadata: {
        description?: string;
        dayOfWeek?: number;
        time?: string;
        startDate?: string;
        weeksAhead?: number;
        platforms?: string[];
        heroMedia?: { assetId: string; mediaType: "image" | "video" }[];
        displayEndDate?: string;
        ctaUrl?: string;
        ctaLabel?: string;
        linkInBioUrl?: string;
        proofPointMode?: string;
        proofPointsSelected?: string[];
        proofPointIntentTags?: string[];
        cadence?: unknown; // Keep as unknown for parsing validation if needed, or structured if known
        advanced?: unknown;
    } | null;
}

export interface ContentItemRow {
    id: string;
    scheduled_for: string | null;
    platform: ProviderPlatform;
    placement: "feed" | "story";
    status: ContentStatus | null;
}

export type AdvancedOptions = WeeklyAdvancedOptions;

export interface CadenceEntry {
    platform: ProviderPlatform;
    weekday: number;
    hour: number;
    minute: number;
}

export interface MaterialiseWorkerConfig {
    supabaseUrl: string;
    serviceRoleKey: string;
    defaultWeeksAhead: number;
    dedupeWindowMinutes: number;
}

function readEnv(name: string): string | undefined {
    const denoEnv = (globalThis as typeof globalThis & {
        Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno?.env;
    if (denoEnv?.get) {
        return denoEnv.get(name);
    }
    if (typeof process !== "undefined") {
        return process.env?.[name];
    }
    return undefined;
}

export function createDefaultConfig(): MaterialiseWorkerConfig {
    return {
        supabaseUrl: readEnv("NEXT_PUBLIC_SUPABASE_URL")!,
        serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY")!,
        defaultWeeksAhead: Number(readEnv("WEEKLY_HORIZON_WEEKS") ?? 4),
        dedupeWindowMinutes: Number(readEnv("WEEKLY_DEDUPE_WINDOW_MINUTES") ?? 45),
    };
}

const DEFAULT_ADVANCED: AdvancedOptions = {
    toneAdjust: "default",
    lengthPreference: "standard",
    includeHashtags: true,
    includeEmojis: true,
    ctaStyle: "default",
};
const SLOT_INCREMENT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;

export class WeeklyMaterialiser {
    private supabase: SupabaseClient;
    private config: MaterialiseWorkerConfig;

    constructor(config: MaterialiseWorkerConfig, supabaseClient?: SupabaseClient) {
        this.config = config;
        this.supabase = supabaseClient ?? createClient(config.supabaseUrl, config.serviceRoleKey, {
            auth: { persistSession: false },
        });
    }

    async run(now = new Date()) {
        const { data: campaigns, error } = await this.supabase
            .from("campaigns")
            .select("id, account_id, name, auto_confirm, metadata")
            .eq("campaign_type", "weekly")
            .eq("status", "scheduled")
            .returns<WeeklyCampaignRow[]>();

        if (error) {
            console.error("[materialise-weekly] failed to fetch campaigns", error);
            throw error;
        }

        let createdCount = 0;
        for (const campaign of campaigns ?? []) {
            createdCount += await this.materialiseForCampaign(campaign, now);
        }
        return createdCount;
    }

    async materialiseForCampaign(campaign: WeeklyCampaignRow, now: Date) {
        const metadata = campaign.metadata ?? {};
        const description = metadata.description ?? "";
        const dayOfWeek = clampDay(metadata.dayOfWeek ?? 0);
        const time = metadata.time ?? "07:00";
        const heroMedia = Array.isArray(metadata.heroMedia) ? metadata.heroMedia : [];
        const platforms = (metadata.platforms && metadata.platforms.length
            ? metadata.platforms
            : ["facebook", "instagram"]) as ProviderPlatform[];
        const weeksAhead = metadata.weeksAhead ?? this.config.defaultWeeksAhead;
        const startDate = metadata.startDate ? new Date(metadata.startDate) : now;
        const displayEndDate = metadata.displayEndDate ? new Date(metadata.displayEndDate) : null;
        const autoConfirm = Boolean(campaign.auto_confirm);
        const ctaUrl = typeof metadata.ctaUrl === "string" ? metadata.ctaUrl : null;
        const ctaLabel = typeof metadata.ctaLabel === "string" ? metadata.ctaLabel : null;
        const linkInBioUrl = typeof metadata.linkInBioUrl === "string" ? metadata.linkInBioUrl : null;
        const proofPointMode = typeof metadata.proofPointMode === "string" ? metadata.proofPointMode : null;
        const proofPointsSelected = Array.isArray(metadata.proofPointsSelected)
            ? metadata.proofPointsSelected.filter((item) => typeof item === "string")
            : [];
        const proofPointIntentTags = Array.isArray(metadata.proofPointIntentTags)
            ? metadata.proofPointIntentTags.filter((item) => typeof item === "string")
            : [];

        const cadence = this.parseCadence(metadata.cadence, platforms, dayOfWeek, time);
        const advanced = this.parseAdvanced(metadata.advanced);
        const computedHorizon = new Date(now.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000);
        const horizon = displayEndDate && displayEndDate > now ? displayEndDate : computedHorizon;

        const { data: contentItems, error } = await this.supabase
            .from("content_items")
            .select("id, scheduled_for, platform, placement, status")
            .eq("account_id", campaign.account_id)
            .gte("scheduled_for", now.toISOString())
            .lte("scheduled_for", horizon.toISOString())
            .returns<ContentItemRow[]>();

        if (error) {
            console.error("[materialise-weekly] failed to fetch content_items", error);
            return 0;
        }

        const occupiedByDay = new Map<string, Set<number>>();
        for (const item of contentItems ?? []) {
            if (!item.scheduled_for) continue;
            if (item.placement === "story") continue;
            const scheduledDate = new Date(item.scheduled_for);
            if (!Number.isFinite(scheduledDate.getTime())) continue;
            reserveSlotOnSameDay(scheduledDate, item.platform, occupiedByDay);
        }

        const inserts: {
            scheduledFor: Date;
            platform: ProviderPlatform;
            body: string;
            mediaIds: string[];
            status: ContentStatus;
            placement: "feed" | "story";
            advanced: AdvancedOptions;
        }[] = [];

        for (const cadenceEntry of cadence) {
            const firstOccurrence = getFirstOccurrenceAfter(
                startDate,
                cadenceEntry.weekday,
                formatTimeParts(cadenceEntry.hour, cadenceEntry.minute),
                now,
            );

            let iteration = 0;
            while (true) {
                const requestedOccurrence = new Date(firstOccurrence.getTime() + iteration * 7 * 24 * 60 * 60 * 1000);
                if (requestedOccurrence > horizon) break;
                const mediaIds = heroMedia.map((asset) => asset.assetId);
                let occurrence: Date;
                try {
                    occurrence = reserveSlotOnSameDay(requestedOccurrence, cadenceEntry.platform, occupiedByDay);
                } catch (error) {
                    console.warn("[materialise-weekly] no same-day slot available", {
                        campaignId: campaign.id,
                        requested: requestedOccurrence.toISOString(),
                        error: error instanceof Error ? error.message : String(error),
                    });
                    iteration += 1;
                    continue;
                }
                if (occurrence > horizon) break;

                const body = buildWeeklyCopy(
                    campaign.name,
                    description,
                    occurrence,
                    cadenceEntry.platform,
                    advanced,
                    { ctaUrl, ctaLabel, linkInBioUrl },
                );
                const status: ContentStatus = autoConfirm ? "scheduled" : "draft";
                inserts.push({
                    scheduledFor: occurrence,
                    platform: cadenceEntry.platform,
                    body,
                    mediaIds,
                    status,
                    placement: "feed",
                    advanced,
                });

                iteration += 1;
            }
        }

        if (!inserts.length) {
            return 0;
        }

        const nowIso = new Date().toISOString();

        const { data: newContent, error: insertError } = await this.supabase
            .from("content_items")
            .insert(
                inserts.map((entry) => ({
                    campaign_id: campaign.id,
                    account_id: campaign.account_id,
                    platform: entry.platform,
                    placement: entry.placement,
                    scheduled_for: entry.scheduledFor.toISOString(),
                    status: entry.status,
                    prompt_context: {
                        slot: entry.scheduledFor.toISOString(),
                        type: "weekly",
                        advanced: entry.advanced,
                        ctaUrl,
                        ctaLabel,
                        linkInBioUrl,
                        proofPointMode,
                        proofPointsSelected,
                        proofPointIntentTags,
                    },
                    auto_generated: true,
                })),
            )
            .select("id, platform, scheduled_for");

        if (insertError) {
            console.error("[materialise-weekly] failed to insert content_items", insertError);
            return 0;
        }

        const createdEntries = (newContent ?? []).map((content, index) => ({
            content,
            entry: inserts[index]!,
        }));

        const contentIds: string[] = [];

        for (const { content, entry } of createdEntries) {
            contentIds.push(content.id);
            const { error: variantError } = await this.supabase
                .from("content_variants")
                .upsert({
                    content_item_id: content.id,
                    body: entry.body,
                    media_ids: entry.mediaIds.length ? entry.mediaIds : null,
                });

            if (variantError) {
                console.error("[materialise-weekly] failed to upsert content variant", variantError);
            }
        }

        const scheduledEntries = createdEntries.filter(({ entry }) => entry.status === "scheduled");

        if (scheduledEntries.length) {
            const scheduledContentIds = scheduledEntries.map(({ content }) => content.id);
            const { data: variantRows, error: variantsError } = await this.supabase
                .from("content_variants")
                .select("id, content_item_id")
                .in("content_item_id", scheduledContentIds);

            if (variantsError) {
                console.error("[materialise-weekly] failed to load variants for publish jobs", variantsError);
            }

            const variantIdByContent = new Map(
                (variantRows ?? []).map((row) => [row.content_item_id, row.id]),
            );

            const jobRows = scheduledEntries
                .map(({ content, entry }) => {
                    const variantId = variantIdByContent.get(content.id);
                    if (!variantId) {
                        console.error("[materialise-weekly] missing variant id for scheduled content", {
                            contentId: content.id,
                            campaignId: campaign.id,
                        });
                        return null;
                    }
                    return {
                        content_item_id: content.id,
                        variant_id: variantId,
                        status: "queued",
                        next_attempt_at: content.scheduled_for ?? nowIso,
                        placement: entry.placement,
                    };
                })
                .filter((row): row is NonNullable<typeof row> => Boolean(row));

            if (jobRows.length) {
                const { error: jobsError } = await this.supabase
                    .from("publish_jobs")
                    .insert(jobRows);

                if (jobsError) {
                    console.error("[materialise-weekly] failed to insert publish_jobs", jobsError);
                }
            }
        }

        const scheduledCount = scheduledEntries.length;
        const draftEntries = createdEntries.filter(({ entry }) => entry.status === "draft");
        const draftCount = draftEntries.length;

        const messageDetails: string[] = [];
        if (scheduledCount) messageDetails.push(`${scheduledCount} scheduled`);
        if (draftCount) messageDetails.push(`${draftCount} awaiting approval`);

        const notificationMessage = messageDetails.length
            ? `Created ${createdEntries.length} weekly posts for ${campaign.name} (${messageDetails.join(", ")})`
            : `Created ${createdEntries.length} weekly posts for ${campaign.name}`;

        await this.supabase
            .from("notifications")
            .insert({
                account_id: campaign.account_id,
                category: "weekly_materialised",
                message: notificationMessage,
                metadata: {
                    campaignId: campaign.id,
                    contentItemIds: contentIds,
                    scheduledContentIds: scheduledEntries.map(({ content }) => content.id),
                    draftContentIds: draftEntries.map(({ content }) => content.id),
                },
            });

        return contentIds.length;
    }

    private parseAdvanced(raw: unknown): AdvancedOptions {
        if (!raw || typeof raw !== "object") {
            return { ...DEFAULT_ADVANCED };
        }
        const source = raw as Record<string, unknown>;
        return {
            toneAdjust:
                typeof source.toneAdjust === "string" ? (source.toneAdjust as string) : DEFAULT_ADVANCED.toneAdjust,
            lengthPreference:
                typeof source.lengthPreference === "string"
                    ? (source.lengthPreference as string)
                    : DEFAULT_ADVANCED.lengthPreference,
            includeHashtags:
                typeof source.includeHashtags === "boolean"
                    ? (source.includeHashtags as boolean)
                    : DEFAULT_ADVANCED.includeHashtags,
            includeEmojis:
                typeof source.includeEmojis === "boolean"
                    ? (source.includeEmojis as boolean)
                    : DEFAULT_ADVANCED.includeEmojis,
            ctaStyle:
                typeof source.ctaStyle === "string" ? (source.ctaStyle as string) : DEFAULT_ADVANCED.ctaStyle,
        };
    }

    private parseCadence(
        raw: unknown,
        fallbackPlatforms: ProviderPlatform[],
        fallbackDay: number,
        fallbackTime: string,
    ): CadenceEntry[] {
        const entries: CadenceEntry[] = [];
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (!item || typeof item !== "object") continue;
                const record = item as Record<string, unknown>;
                const platform = record["platform"] as string;
                const weekday = record["weekday"];
                const hour = record["hour"];
                const minute = record["minute"];
                if (platform === "facebook" || platform === "instagram" || platform === "gbp") {
                    if (typeof weekday === "number" && typeof hour === "number" && typeof minute === "number") {
                        entries.push({
                            platform: platform as ProviderPlatform,
                            weekday,
                            hour,
                            minute,
                        });
                    }
                }
            }
        }
        if (entries.length) {
            return entries;
        }
        const [fallbackHour, fallbackMinute] = parseTimeParts(fallbackTime);
        return fallbackPlatforms.map((platform) => ({
            platform,
            weekday: fallbackDay,
            hour: fallbackHour,
            minute: fallbackMinute,
        }));
    }
}

function parseTimeParts(time: string): [number, number] {
    const [hourStr = "07", minuteStr = "0"] = time.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const safeHour = Number.isFinite(hour) ? hour : 7;
    const safeMinute = Number.isFinite(minute) ? minute : 0;
    return [safeHour, safeMinute];
}

function formatTimeParts(hour: number, minute: number) {
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function toScheduleSlot(date: Date) {
    const dayKey = date.toISOString().slice(0, 10);
    const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
    return { dayKey, minuteOfDay };
}

function buildScheduleBucketKey(channel: ProviderPlatform, dayKey: string) {
    return `${channel}|${dayKey}`;
}

function reserveSlotOnSameDay(
    requested: Date,
    channel: ProviderPlatform,
    occupiedByDay: Map<string, Set<number>>,
) {
    const slot = toScheduleSlot(requested);
    const bucketKey = buildScheduleBucketKey(channel, slot.dayKey);
    const occupied = occupiedByDay.get(bucketKey) ?? new Set<number>();
    let minuteOfDay = slot.minuteOfDay;

    while (occupied.has(minuteOfDay)) {
        minuteOfDay += SLOT_INCREMENT_MINUTES;
        if (minuteOfDay >= MINUTES_PER_DAY) {
            throw new Error(`No open 30-minute schedule slots remain on ${slot.dayKey}.`);
        }
    }

    occupied.add(minuteOfDay);
    occupiedByDay.set(bucketKey, occupied);

    const resolved = new Date(requested);
    resolved.setUTCHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
    return resolved;
}
