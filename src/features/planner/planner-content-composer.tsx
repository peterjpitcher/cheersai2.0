"use client";

import { useEffect, useMemo, useState, useTransition, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import clsx from "clsx";
import {
  Bookmark,
  CheckCircle2,
  Globe,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Share2,
  ThumbsUp,
  X,
} from "lucide-react";

import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";

const EDITABLE_STATUSES = new Set<PlannerContentDetail["status"]>([
  "draft",
  "scheduled",
  "queued",
  "failed",
]);

const PLATFORM_THEME: Record<
  PlannerContentDetail["platform"],
  {
    shell: string;
    badge: string;
    frame: string;
    subheader: string;
  }
> = {
  facebook: {
    shell: "border-[#D7E6FF] bg-[#F8FBFF]",
    badge: "bg-[#E8F1FF] text-[#1B4DB1]",
    frame: "border-[#D7E6FF] bg-white",
    subheader: "text-[#1B4DB1]/75",
  },
  instagram: {
    shell: "border-[#F5D8EA] bg-[#FFF8FC]",
    badge: "bg-[#FEE7F8] text-[#C2338B]",
    frame: "border-[#F5D8EA] bg-white",
    subheader: "text-[#C2338B]/75",
  },
  gbp: {
    shell: "border-[#D5EEDD] bg-[#F7FCF8]",
    badge: "bg-[#EAF8ED] text-[#1C7C43]",
    frame: "border-[#D5EEDD] bg-white",
    subheader: "text-[#1C7C43]/75",
  },
};

interface PlannerContentComposerProps {
  detail: PlannerContentDetail;
  ownerTimezone: string;
  mediaLibrary: MediaAssetSummary[];
}

export function PlannerContentComposer({ detail, ownerTimezone, mediaLibrary }: PlannerContentComposerProps) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState(detail.body ?? "");
  const [baseline, setBaseline] = useState(detail.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [isSavingCopy, startSaveCopyTransition] = useTransition();
  const [isRefreshing, startRefreshTransition] = useTransition();

  useEffect(() => {
    if (!isMediaModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMediaModalOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [isMediaModalOpen]);

  const theme = PLATFORM_THEME[detail.platform];
  const status = detail.status;
  const isStory = detail.placement === "story";
  const canEdit = EDITABLE_STATUSES.has(status);
  const canEditCopy = canEdit && !isStory;
  const isDirty = body.trim() !== baseline.trim();
  const isBusy = isSavingCopy || isRefreshing;
  const primaryMedia = detail.media[0] ?? null;

  const mediaAspectClass = isStory
    ? "mx-auto max-w-[360px] aspect-[9/16]"
    : "mx-auto w-full max-w-[520px] aspect-square";

  const timezoneLabel = ownerTimezone.replace(/_/g, " ");
  const scheduledLabel = useMemo(() => {
    if (!detail.scheduledFor) return "Pending";
    const local = DateTime.fromISO(detail.scheduledFor, { zone: "utc" }).setZone(ownerTimezone);
    if (!local.isValid) return "Pending";
    return `${local.toFormat("cccc d LLLL yyyy · HH:mm")} (${timezoneLabel})`;
  }, [detail.scheduledFor, ownerTimezone, timezoneLabel]);

  const handleCopyReset = () => {
    setBody(baseline);
    setError(null);
  };

  const handleCopyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setBody(event.target.value);
    if (error) setError(null);
  };

  const handleCopySave = () => {
    if (!canEditCopy || isBusy) return;
    const trimmed = body.trim();
    if (!trimmed.length) {
      setError("Write something before saving.");
      return;
    }

    setError(null);
    startSaveCopyTransition(async () => {
      try {
        await updatePlannerContentBody({ contentId: detail.id, body: trimmed });
        setBaseline(trimmed);
        setBody(trimmed);
        toast.success("Post copy updated", {
          description: "Your changes were saved.",
        });
        startRefreshTransition(() => {
          router.refresh();
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save post copy.";
        setError(message);
        toast.error("Save failed", { description: message });
      }
    });
  };

  const handleApproved = (result: { status: string; scheduledFor: string | null }) => {
    if (!result.status && !result.scheduledFor) return;
    startRefreshTransition(() => {
      router.refresh();
    });
  };

  const handleMediaUpdated = () => {
    setIsMediaModalOpen(false);
    startRefreshTransition(() => {
      router.refresh();
    });
  };
  const portalRoot = typeof document === "undefined" ? null : document.body;

  return (
    <>
      <article className={clsx("overflow-hidden rounded-3xl border shadow-sm", theme.shell)}>
        <header className="flex flex-col gap-3 border-b border-black/5 bg-white/80 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", theme.badge)}>
              {formatPlatformLabel(detail.platform)}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {detail.placement === "story" ? "Story" : "Feed"}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {formatStatusLabel(status)}
            </span>
          </div>
          <p className={clsx("text-xs font-medium", theme.subheader)}>
            Scheduled: {scheduledLabel}
          </p>
        </header>

        <div className="space-y-4 p-4 md:p-5">
          <div className={clsx("relative overflow-hidden rounded-2xl border", theme.frame, mediaAspectClass)}>
            {primaryMedia ? (
              primaryMedia.mediaType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={primaryMedia.url}
                  alt={primaryMedia.fileName ?? "Post media"}
                  className="h-full w-full object-contain"
                />
              ) : (
                <video
                  src={primaryMedia.url}
                  className="h-full w-full object-contain"
                  preload="metadata"
                  muted
                  playsInline
                  controls
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No media attached
              </div>
            )}

            <div className="absolute right-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-2">
              <span className="shrink-0 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm">
                {detail.media.length} asset{detail.media.length === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsMediaModalOpen(true)}
                disabled={!canEdit || isBusy}
                className="max-w-full gap-1 bg-white/95 text-xs"
              >
                <RefreshCw className="h-3 w-3" />
                Replace
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-black/5 bg-white px-4 py-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                  {detail.platform === "facebook" ? "F" : detail.platform === "instagram" ? "IG" : "GB"}
                </span>
                <span>{detail.campaign?.name ?? "Untitled campaign"}</span>
              </div>
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </div>

            {isStory ? (
              <p className="text-sm leading-relaxed text-slate-600">
                Stories publish without caption text. Use <span className="font-semibold">Replace</span> to change the visual,
                then approve when ready.
              </p>
            ) : (
              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Caption · {body.length.toLocaleString()} chars
                </span>
                <textarea
                  value={body}
                  onChange={handleCopyChange}
                  rows={9}
                  readOnly={!canEditCopy || isBusy}
                  className="min-h-[220px] resize-y rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-inner outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/30 disabled:cursor-not-allowed disabled:opacity-75"
                />
              </label>
            )}

            <div className="mt-3 border-t border-slate-200 pt-3 text-slate-500">
              {detail.platform === "instagram" ? (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <Heart className="h-4 w-4" />
                    <MessageCircle className="h-4 w-4" />
                    <Send className="h-4 w-4" />
                  </div>
                  <Bookmark className="h-4 w-4" />
                </div>
              ) : detail.platform === "facebook" ? (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1"><ThumbsUp className="h-4 w-4" />Like</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-4 w-4" />Comment</span>
                  <span className="inline-flex items-center gap-1"><Share2 className="h-4 w-4" />Share</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1"><Search className="h-4 w-4" />Search</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />Directions</span>
                  <span className="inline-flex items-center gap-1"><Globe className="h-4 w-4" />Website</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-black/5 bg-white px-4 py-3">
            {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
            {!error && !canEdit ? (
              <p className="text-xs text-slate-500">This post can no longer be edited.</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {!isStory ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyReset}
                      disabled={!isDirty || isBusy}
                    >
                      Reset
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleCopySave}
                      disabled={!canEditCopy || !isDirty || isBusy}
                    >
                      {isSavingCopy ? "Saving…" : "Save caption"}
                    </Button>
                  </>
                ) : null}
              </div>
              {status === "draft" ? (
                <ApproveDraftButton contentId={detail.id} disableRefresh onApproved={handleApproved} />
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  {formatStatusLabel(status)}
                </span>
              )}
            </div>
          </div>
        </div>
      </article>

      {isMediaModalOpen && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 z-0 bg-slate-900/60 backdrop-blur-sm"
                aria-label="Close media editor"
                onClick={() => setIsMediaModalOpen(false)}
              />
              <div className="relative z-10 my-6 w-full max-w-4xl overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Media editor</p>
                    <h2 className="text-lg font-semibold text-slate-900">{detail.campaign?.name ?? "Planned post"}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMediaModalOpen(false)}
                    className="rounded-full border border-slate-300 p-1.5 text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                    aria-label="Close media editor"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>
                <div className="max-h-[80vh] overflow-y-auto p-5">
                  <PlannerContentMediaEditor
                    contentId={detail.id}
                    initialMedia={(detail.media ?? []).map((media) => ({
                      id: media.id,
                      mediaType: media.mediaType,
                      fileName: media.fileName,
                    }))}
                    mediaLibrary={mediaLibrary}
                    placement={detail.placement}
                    returnToPlannerAfterSave={false}
                    disableRouterRefresh
                    onUpdated={handleMediaUpdated}
                  />
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
