"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { DateTime } from "luxon";
import clsx from "clsx";
import { Bookmark, CalendarDays, Clock3, Heart, Layers, MessageCircle, RefreshCw, X } from "lucide-react";

import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";

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
      const key = scheduled ? scheduled.startOf("minute").toISO() ?? item.id : `draft-${item.id}`;
      const existing = map.get(key) ?? {
        key,
        dateTime: scheduled,
        campaigns: [],
        items: {},
      };

      existing.items[item.platform] = item;
      if (item.campaign?.name && !existing.campaigns.includes(item.campaign.name)) {
        existing.campaigns.push(item.campaign.name);
      }

      map.set(key, existing);
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

  const handleRefresh = async (contentId: string) => {
    setPendingContentId(contentId);
    try {
      await onRefreshItem(contentId);
    } finally {
      setPendingContentId((current) => (current === contentId ? null : current));
    }
  };

  return (
    <>
      <section className="space-y-6">
        {rows.map((row) => {
          const posts = activePlatforms.map((platform) => row.items[platform]).filter((value): value is PlannerContentDetail => Boolean(value));
          const postsCount = posts.length;
          const scheduledLabel = row.dateTime
            ? row.dateTime.toFormat("cccc d LLLL yyyy · HH:mm")
            : "Awaiting schedule";
          const relativeLabel = row.dateTime ? row.dateTime.toRelative({ base: DateTime.now() }) : null;
          const campaignSummary = row.campaigns.join(" · ");

          return (
            <article
              key={row.key}
              className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-6"
            >
              <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{scheduledLabel}</p>
                  <p className="text-xs text-slate-500">Timezone: {ownerTimezoneLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                    <CalendarDays className="h-3 w-3" /> {postsCount} draft{postsCount === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                    <Layers className="h-3 w-3" /> {activePlatforms.length} platform{activePlatforms.length === 1 ? "" : "s"}
                  </span>
                  {campaignSummary ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                      {campaignSummary}
                    </span>
                  ) : null}
                  {relativeLabel ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700">
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
                        className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-400"
                      >
                        No draft for {formatPlatformLabel(platform)} on this date.
                      </div>
                    );
                  }

                  const primaryMedia = item.media[0];
                  const isBusy = pendingContentId === item.id;
                  const accent = PLATFORM_ACCENTS[item.platform];

                  return (
                    <article key={platform} className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase",
                            accent.badge,
                          )}
                        >
                          <span className={clsx("h-2 w-2 rounded-full", accent.dot)} />
                          {formatPlatformLabel(item.platform)}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">{formatStatusLabel(item.status)}</span>
                      </div>
                      <div className="relative flex h-40 w-full items-center justify-center bg-slate-200">
                        {primaryMedia ? (
                          primaryMedia.mediaType === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={primaryMedia.url}
                              alt={primaryMedia.fileName ?? "Post media"}
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : (
                            <video
                              src={primaryMedia.url}
                              controls
                              className="max-h-full max-w-full object-contain"
                              preload="metadata"
                            />
                          )
                        ) : (
                          <div className="text-xs text-slate-500">No media attached</div>
                        )}
                        <button
                          type="button"
                          onClick={() => setMediaTarget(item)}
                          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-white"
                        >
                          <RefreshCw className="h-3 w-3" /> Replace image
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                        <pre className="whitespace-pre-wrap leading-relaxed">{item.body}</pre>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
                        <div className="flex items-center gap-3 text-[11px] text-slate-500">
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
                        <ApproveDraftButton
                          contentId={item.id}
                          disableRefresh
                          onApproved={() => void handleRefresh(item.id)}
                        />
                      </div>
                      {isBusy ? <p className="px-3 pb-2 text-[11px] text-slate-500">Refreshing preview…</p> : null}
                    </article>
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

interface MediaSwapModalProps {
  content: PlannerContentDetail;
  mediaLibrary: MediaAssetSummary[];
  onLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  onClose: () => void;
  onRefresh: (contentId: string) => Promise<void>;
}

function MediaSwapModal({ content, mediaLibrary, onLibraryUpdate, onClose, onRefresh }: MediaSwapModalProps) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Swap media</p>
            <h2 className="text-lg font-semibold text-slate-900">
              {content.campaign?.name ?? "Generated draft"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
            aria-label="Close media modal"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[80vh] overflow-y-auto p-6">
          <PlannerContentMediaEditor
            contentId={content.id}
            initialMedia={content.media.map((media) => ({
              id: media.id,
              mediaType: media.mediaType,
              fileName: media.fileName,
            }))}
            mediaLibrary={mediaLibrary}
            disableRouterRefresh
            onUpdated={async (contentId) => {
              await onRefresh(contentId);
              onClose();
            }}
            onLibraryUpdate={onLibraryUpdate}
          />
        </div>
      </div>
    </div>
  );
}
