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
import { DateTime } from "luxon";
import clsx from "clsx";
import { Bookmark, CalendarDays, CheckCircle2, Clock3, Heart, Layers, Loader2, MessageCircle, RefreshCw, Undo2, X } from "lucide-react";

import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

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

                  const accent = PLATFORM_ACCENTS[item.platform];

                  return (
                    <GeneratedContentCard
                      key={platform}
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

  useEffect(() => {
    setBody(item.body ?? "");
    setIsDirty(false);
    setError(null);
  }, [item.id, item.body]);

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
        "flex h-full w-full max-w-[430px] flex-col overflow-hidden rounded-2xl border shadow-sm transition",
        isApproved ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2">
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
            <span className="inline-flex items-center rounded-full bg-brand-sandstone/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-sandstone">
              Story
            </span>
          ) : null}
        </div>
        <span className="text-[11px] font-medium text-slate-400">{formatStatusLabel(item.status)}</span>
      </div>
      <div className="relative mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl bg-slate-200 aspect-[4/5]">
        {primaryMedia ? (
          primaryMedia.mediaType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={primaryMedia.url}
              alt={primaryMedia.fileName ?? "Post media"}
              className="h-full w-full object-cover"
            />
          ) : (
            <video
              src={primaryMedia.url}
              controls
              className="h-full w-full object-cover"
              preload="metadata"
            />
          )
        ) : (
          <div className="text-xs text-slate-500">No media attached</div>
        )}
        <button
          type="button"
          onClick={onRequestMedia}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-ambergold px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-ambergold/90"
        >
          <RefreshCw className="h-3 w-3" /> Replace image
        </button>
      </div>
      <div className="flex-1 border-t border-slate-200 bg-white">
        {isStory ? (
          <div className="h-full px-4 py-3 text-sm leading-relaxed text-slate-500">
            Stories publish without copy. Swap the attachment if needed, then approve when you’re ready.
          </div>
        ) : (
          <label className="flex h-full flex-col gap-3 px-4 py-3 text-sm text-slate-700">
            <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
              Post copy
              <span className="text-slate-400">{body.length.toLocaleString()} chars</span>
            </span>
            <textarea
              value={body}
              onChange={handleChange}
              readOnly={isApproved || isBusy}
              rows={8}
              className="h-full min-h-[220px] resize-y rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-[15px] font-medium leading-relaxed text-slate-800 shadow-inner outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/30 disabled:cursor-not-allowed disabled:opacity-75"
            />
          </label>
        )}
      </div>
      <div className="space-y-2 border-t border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
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
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Approved
            </span>
          ) : (
            <ApproveDraftButton contentId={item.id} disableRefresh onApproved={() => void onRefresh(item.id)} />
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-rose-600">{isStory ? null : error}</div>
          <div className="flex items-center gap-2">
            {isStory ? (
              <span className="text-[11px] text-slate-400">No copy to edit</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!isDirty || isBusy}
                  className="inline-flex items-center gap-1 rounded-full border border-brand-ambergold bg-brand-ambergold px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-ambergold/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Undo2 className="h-3 w-3" /> Reset
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || isApproved || isBusy}
                  className="inline-flex items-center gap-2 rounded-full bg-brand-ambergold px-4 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-ambergold/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Save changes
                </button>
              </>
            )}
          </div>
        </div>
        {busyLabel ? <p className="text-right text-[10px] font-medium uppercase tracking-wide text-slate-400">{busyLabel}</p> : null}
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
            placement={content.placement}
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
