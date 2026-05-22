"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { DateTime } from "luxon";
import clsx from "clsx";
import { Bookmark, CalendarDays, CheckCircle2, Clock3, Heart, Layers, Loader2, MessageCircle, RefreshCw, Undo2, X } from "lucide-react";

import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { BannerControls } from "@/features/planner/banner-controls";
import { BannerOverlay } from "@/features/planner/banner-overlay";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { closeMediaSwapModalAndRefresh } from "@/features/create/media-swap-utils";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import type { ResolvedConfig } from "@/lib/banner/config";
import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import {
  MediaFrame,
  resolveMediaPlacement,
} from "@/components/media/media-frame";

type Platform = PlannerContentDetail["platform"];

const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "gbp"];

const PLATFORM_ACCENTS: Record<Platform, { badge: string; dot: string }> = {
  facebook: { badge: "bg-[#E8F1FF] text-[#1B4DB1]", dot: "bg-[#1B4DB1]" },
  instagram: { badge: "bg-[#FEE7F8] text-[#C2338B]", dot: "bg-[#C2338B]" },
  gbp: { badge: "bg-[#EAF8ED] text-[#1C7C43]", dot: "bg-[#1C7C43]" },
};

interface GeneratedContentReviewListProps {
  items: PlannerContentDetail[];
  ownerTimezone: string;
  mediaLibrary: MediaAssetSummary[];
  onLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  onRefreshItem: (contentId: string) => Promise<void>;
}

interface ReviewRow {
  key: string;
  dateTime: DateTime | null;
  campaigns: string[];
  items: Partial<Record<Platform, PlannerContentDetail>>;
}

export function GeneratedContentReviewList({
  items,
  ownerTimezone,
  mediaLibrary,
  onLibraryUpdate,
  onRefreshItem,
}: GeneratedContentReviewListProps) {
  const [pendingContentId, setPendingContentId] = useState<string | null>(null);
  const [mediaTarget, setMediaTarget] = useState<PlannerContentDetail | null>(null);

  const rows = useMemo<ReviewRow[]>(() => {
    const map = new Map<string, ReviewRow>();

    items.forEach((item) => {
      const scheduled = item.scheduledFor
        ? DateTime.fromISO(item.scheduledFor, { zone: "utc" }).setZone(ownerTimezone)
        : null;

      // Group by campaign + planIndex (stable plan identity).
      // Fallback chain for older content without planIndex:
      //   promptContext.slot / phase / occurrenceIndex → day → item id
      const campaignId = item.campaign?.id ?? "no-campaign";
      const ctx = item.promptContext as Record<string, unknown> | null;
      const planIndex = ctx?.planIndex;
      const legacySlot = ctx?.slot ?? ctx?.phase ?? ctx?.occurrenceIndex ?? ctx?.slotIndex;
      const planKey = planIndex != null
        ? `${campaignId}:plan-${planIndex}`
        : legacySlot != null
          ? `${campaignId}:slot-${legacySlot}`
          : scheduled
            ? `${campaignId}:day-${scheduled.startOf("day").toISODate()}`
            : `draft-${item.id}`;

      const existing = map.get(planKey) ?? {
        key: planKey,
        dateTime: scheduled,
        campaigns: [],
        items: {},
      };

      // Use the earliest scheduled time for the row header
      if (scheduled && (!existing.dateTime || scheduled.toMillis() < existing.dateTime.toMillis())) {
        existing.dateTime = scheduled;
      }

      existing.items[item.platform] = item;
      if (item.campaign?.name && !existing.campaigns.includes(item.campaign.name)) {
        existing.campaigns.push(item.campaign.name);
      }

      map.set(planKey, existing);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.dateTime && b.dateTime) {
        return a.dateTime.toMillis() - b.dateTime.toMillis();
      }
      if (a.dateTime && !b.dateTime) {
        return -1;
      }
      if (!a.dateTime && b.dateTime) {
        return 1;
      }
      return a.key.localeCompare(b.key);
    });
  }, [items, ownerTimezone]);

  const handleRefresh = useCallback(
    async (contentId: string) => {
      setPendingContentId(contentId);
      try {
        await onRefreshItem(contentId);
      } finally {
        setPendingContentId((current) => (current === contentId ? null : current));
      }
    },
    [onRefreshItem],
  );

  if (!rows.length) {
    return null;
  }

  const ownerTimezoneLabel = ownerTimezone.replace(/_/g, " ");

  const activePlatforms = PLATFORM_ORDER.filter((platform) =>
    items.some((item) => item.platform === platform),
  );

  const gridColumnsClass = clsx("grid gap-4", {
    "md:grid-cols-2": activePlatforms.length >= 2,
    "xl:grid-cols-3": activePlatforms.length >= 3,
    "2xl:grid-cols-4": activePlatforms.length >= 4,
  });

  return (
    <>
      <section className="space-y-6">
        {rows.map((row) => {
          const posts = activePlatforms.map((platform) => row.items[platform]).filter((value): value is PlannerContentDetail => Boolean(value));
          const postsCount = posts.length;
          const scheduledLabel = row.dateTime
            ? row.dateTime.toFormat("cccc d LLLL yyyy · HH:mm")
            : "Awaiting schedule";
          const relativeLabel = row.dateTime
            ? row.dateTime.toRelative({ base: DateTime.now().setZone(ownerTimezone) })
            : null;
          const campaignSummary = row.campaigns.join(" · ");

          return (
            <article
              key={row.key}
              className="space-y-4 rounded-[var(--r-xl)] border border-[var(--c-line)] bg-[var(--c-card)] p-4 shadow-sm md:p-6"
            >
              <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--c-ink)]">{scheduledLabel}</p>
                  <p className="text-xs text-[var(--c-ink-3)]">Timezone: {ownerTimezoneLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--c-ink-2)]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--c-paper-2)] px-2.5 py-1 font-medium">
                    <CalendarDays className="h-3 w-3" /> {postsCount} draft{postsCount === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--c-paper-2)] px-2.5 py-1 font-medium">
                    <Layers className="h-3 w-3" /> {activePlatforms.length} platform{activePlatforms.length === 1 ? "" : "s"}
                  </span>
                  {campaignSummary ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--c-paper-2)] px-2.5 py-1 font-medium">
                      {campaignSummary}
                    </span>
                  ) : null}
                  {relativeLabel ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--c-orange-soft)] px-2.5 py-1 font-medium text-[var(--c-orange)]">
                      <Clock3 className="h-3 w-3" /> {relativeLabel}
                    </span>
                  ) : null}
                </div>
              </header>
              <div className={gridColumnsClass}>
                {activePlatforms.map((platform) => {
                  const item = row.items[platform];

                  if (!item) {
                    return (
                      <div
                        key={platform}
                        className="flex h-full flex-col items-center justify-center rounded-[var(--r-xl)] border border-dashed border-[var(--c-line)] bg-[var(--c-paper-2)] p-4 text-xs text-[var(--c-ink-4)]"
                      >
                        No draft for {formatPlatformLabel(platform)} on this date.
                      </div>
                    );
                  }

                  const accent = PLATFORM_ACCENTS[item.platform];

                  return (
                    <GeneratedContentCard
                      key={`${platform}-${item.id}-${item.body}`}
                      item={item}
                      accent={accent}
                      onRequestMedia={() => setMediaTarget(item)}
                      onRefresh={handleRefresh}
                      isRefreshing={pendingContentId === item.id}
                    />
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
      {mediaTarget ? (
        <MediaSwapModal
          key={mediaTarget.id}
          content={mediaTarget}
          mediaLibrary={mediaLibrary}
          onLibraryUpdate={onLibraryUpdate}
          onClose={() => setMediaTarget(null)}
          onRefresh={handleRefresh}
        />
      ) : null}
    </>
  );
}

interface GeneratedContentCardProps {
  item: PlannerContentDetail;
  accent: { badge: string; dot: string };
  onRequestMedia: () => void;
  onRefresh: (contentId: string) => Promise<void>;
  isRefreshing: boolean;
}

function GeneratedContentCard({ item, accent, onRequestMedia, onRefresh, isRefreshing }: GeneratedContentCardProps) {
  const toast = useToast();
  const [body, setBody] = useState(item.body ?? "");
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();
  const isStory = item.placement === "story";
  const [bannerOverride, setBannerOverride] = useState<ResolvedConfig | null>(null);
  const bannerConfig = bannerOverride ?? item.bannerConfig;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextBody = event.target.value;
    setBody(nextBody);
    setIsDirty(nextBody !== (item.body ?? ""));
  };

  const handleReset = () => {
    setBody(item.body ?? "");
    setIsDirty(false);
    setError(null);
  };

  const handleSave = () => {
    if (isStory || !isDirty || isSaving || isRefreshing) {
      return;
    }
    const trimmed = body.trim();
    if (!trimmed.length) {
      setError("Write something before saving.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updatePlannerContentBody({ contentId: item.id, body: trimmed });
        toast.success("Draft updated", { description: "Your edits are saved." });
        setIsDirty(false);
        await onRefresh(item.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save changes";
        setError(message);
        toast.error("Save failed", { description: message });
      }
    });
  };

  const isApproved = item.status !== "draft";
  const busyLabel = isSaving ? "Saving…" : isRefreshing ? "Refreshing…" : null;
  const isBusy = isSaving || isRefreshing;

  const primaryMedia = item.media[0];

  return (
    <article
      className={clsx(
        "flex h-full min-w-0 w-full flex-col overflow-hidden rounded-[var(--r-xl)] border shadow-sm transition",
        isApproved ? "border-[#B5E5C5] bg-[#EAF8ED]" : "border-[var(--c-line)] bg-[var(--c-card)]",
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--c-line)] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase",
              accent.badge,
            )}
          >
            <span className={clsx("h-2 w-2 rounded-full", accent.dot)} />
            {formatPlatformLabel(item.platform)}
          </span>
          {isStory ? (
            <span className="inline-flex items-center rounded-full bg-[var(--c-claret-soft)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-claret)]">
              Story
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] font-medium text-[var(--c-ink-4)]">{formatStatusLabel(item.status)}</span>
      </div>
      <MediaFrame
        placement={resolveMediaPlacement({ placement: item.placement })}
        size="preview"
        className="rounded-none border-0"
      >
        {primaryMedia ? (
          primaryMedia.mediaType === "image" ? (
            <BannerOverlay
              mediaUrl={primaryMedia.url}
              config={bannerConfig}
              label={item.bannerLabel}
              className="h-full w-full"
            />
          ) : (
            <video
              src={primaryMedia.url}
              className="h-full w-full object-contain"
              preload="metadata"
              muted
              playsInline
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--c-ink-3)]">No media attached</div>
        )}
        <button
          type="button"
          onClick={onRequestMedia}
          aria-haspopup="dialog"
          className="absolute right-2 top-2 z-20 inline-flex max-w-[calc(100%-1rem)] cursor-pointer items-center gap-1 rounded-full bg-[var(--c-ink)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--c-ink-2)]"
        >
          <RefreshCw className="h-3 w-3 shrink-0" /> <span className="truncate">Replace media</span>
        </button>
      </MediaFrame>
      <div className="border-t border-[var(--c-line)] bg-[var(--c-card)] px-3 py-3">
        <BannerControls
          contentItemId={item.id}
          status={item.status}
          accountDefaults={item.accountBannerDefaults}
          overrides={item.bannerOverrides}
          autoLabel={item.bannerLabel}
          onUpdate={setBannerOverride}
        />
      </div>
      <div className="flex-1 border-t border-[var(--c-line)] bg-[var(--c-card)]">
        {isStory ? (
          <div className="h-full px-4 py-3 text-sm leading-relaxed text-[var(--c-ink-3)]">
            Stories publish without copy. Swap the attachment if needed, then approve when you’re ready.
          </div>
        ) : (
          <label className="flex h-full flex-col gap-3 px-4 py-3 text-sm text-[var(--c-ink-2)]">
            <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[var(--c-ink-3)]">
              Post copy
              <span className="text-[var(--c-ink-4)]">{body.length.toLocaleString()} chars</span>
            </span>
            <textarea
              value={body}
              onChange={handleChange}
              readOnly={isApproved || isBusy}
              rows={8}
              className="h-full min-h-[220px] resize-y rounded-[var(--r-xl)] border border-[var(--c-line-2)] bg-[var(--c-paper-2)] px-4 py-3 text-[15px] font-medium leading-relaxed text-[var(--c-ink)] shadow-inner outline-none focus:border-[var(--c-orange)] focus:ring-2 focus:ring-[var(--c-orange-soft)] disabled:cursor-not-allowed disabled:opacity-75"
            />
          </label>
        )}
      </div>
      <div className="space-y-2 border-t border-[var(--c-line)] bg-[var(--c-card)] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--c-ink-3)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3 w-3" /> —
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3 w-3" /> —
            </span>
            <span className="inline-flex items-center gap-1">
              <Bookmark className="h-3 w-3" /> —
            </span>
          </div>
          {isApproved ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#D1F2DE] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#1C7C43]">
              <CheckCircle2 className="h-3 w-3" /> Approved
            </span>
          ) : (
            <ApproveDraftButton
              contentId={item.id}
              disableRefresh
              onApproved={() => void onRefresh(item.id)}
              onBeforeApprove={async () => {
                if (isDirty && !isStory) {
                  const trimmed = body.trim();
                  if (!trimmed.length) throw new Error("Post copy cannot be empty.");
                  await updatePlannerContentBody({ contentId: item.id, body: trimmed });
                  setIsDirty(false);
                }
                // Banners are now rendered at publish time by the queue worker;
                // approval no longer triggers a render.
              }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1 text-[11px] font-medium text-[var(--c-claret)]">{isStory ? null : error}</div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {isStory ? (
              <span className="text-[11px] text-[var(--c-ink-4)]">No copy to edit</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!isDirty || isBusy}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--c-ink)] bg-[var(--c-ink)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--c-ink-2)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Undo2 className="h-3 w-3" /> Reset
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || isApproved || isBusy}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--c-ink)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--c-ink-2)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Save changes
                </button>
              </>
            )}
          </div>
        </div>
        {busyLabel ? <p className="text-right text-[10px] font-medium uppercase tracking-wide text-[var(--c-ink-4)]">{busyLabel}</p> : null}
      </div>
    </article>
  );
}

interface MediaSwapModalProps {
  content: PlannerContentDetail;
  mediaLibrary: MediaAssetSummary[];
  onLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  onClose: () => void;
  onRefresh: (contentId: string) => Promise<void>;
}

function MediaSwapModal({ content, mediaLibrary, onLibraryUpdate, onClose, onRefresh }: MediaSwapModalProps) {
  const toast = useToast();

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const portalRoot = typeof document === "undefined" ? null : document.body;
  if (!portalRoot) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close media modal"
        className="absolute inset-0 z-0 bg-[var(--c-ink)]/50 backdrop-blur-sm"
      />
      <div className="relative z-10 my-6 w-full max-w-4xl overflow-hidden rounded-[var(--r-xl)] bg-[var(--c-card)] shadow-2xl ring-1 ring-[var(--c-line)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--c-line)] px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--c-ink-3)]">Swap media</p>
            <h2 className="text-lg font-semibold text-[var(--c-ink)]">
              {content.campaign?.name ?? "Generated draft"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--c-line)] p-1.5 text-[var(--c-ink-3)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)]"
            aria-label="Close media modal"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[80vh] overflow-y-auto p-6">
          <PlannerContentMediaEditor
            contentId={content.id}
            initialMedia={(content.media ?? []).map((media) => ({
              id: media.id,
              mediaType: media.mediaType,
              fileName: media.fileName,
            }))}
            mediaLibrary={mediaLibrary}
            placement={content.placement}
            disableRouterRefresh
            onUpdated={(contentId) => {
              void closeMediaSwapModalAndRefresh({
                contentId,
                onClose,
                onRefresh,
                onRefreshError: (error) => {
                  const message = error instanceof Error ? error.message : "Unable to refresh draft.";
                  toast.error("Media updated, but preview failed to refresh", {
                    description: message,
                  });
                },
              });
            }}
            onLibraryUpdate={onLibraryUpdate}
          />
        </div>
      </div>
    </div>,
    portalRoot,
  );
}
