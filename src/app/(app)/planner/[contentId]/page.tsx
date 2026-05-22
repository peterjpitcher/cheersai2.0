import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import {
  ArrowLeft,
  Trash2,
  Play,
  AlertTriangle,
  RefreshCw,
  Link2,
  Download,
  ChevronDown,
} from "lucide-react";

import { PlannerContentScheduleForm } from "@/features/planner/content-schedule-form";
import { PlannerContentComposer } from "@/features/planner/planner-content-composer";
import { formatPlatformLabel } from "@/features/planner/utils";
import { getPlannerContentDetail } from "@/lib/planner/data";
import { listMediaAssets } from "@/lib/library/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { Status } from "@/components/ui/status";
import type { DesignStatus } from "@/components/ui/status";
import { PlatformDot } from "@/components/ui/platform-dot";
import { Button } from "@/components/ui/button";
import { MediaFrameImage, MediaFrameVideo } from "@/components/media/media-frame";

/* ------------------------------------------------------------------ */
/*  Status mapping: PlannerItem status → DesignStatus for Status chip  */
/* ------------------------------------------------------------------ */

function toDesignStatus(
  status: "draft" | "scheduled" | "queued" | "publishing" | "posted" | "failed",
): DesignStatus {
  switch (status) {
    case "posted":
      return "posted";
    case "publishing":
    case "queued":
      return "publishing";
    case "scheduled":
      return "scheduled";
    case "draft":
      return "draft";
    case "failed":
      return "failed";
    default:
      return "draft";
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function relativeCountdown(dt: DateTime): string {
  const diff = dt.diffNow(["days", "hours", "minutes"]);
  if (diff.days >= 1) return `${Math.floor(diff.days)}d ${Math.floor(diff.hours)}h`;
  if (diff.hours >= 1) return `${Math.floor(diff.hours)}h ${Math.floor(diff.minutes)}m`;
  if (diff.minutes >= 1) return `${Math.floor(diff.minutes)}m`;
  return "imminently";
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function PlannerContentPage({
  params,
}: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  const detail = await getPlannerContentDetail(contentId);

  if (!detail) {
    notFound();
  }

  const mediaLibrary = await listMediaAssets({ excludeTags: ["Tournament"] });
  const ownerSettings = await getOwnerSettings();
  const ownerTimezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;
  const ownerTimezoneLabel = ownerTimezone.replace(/_/g, " ");

  const scheduledLocal = detail.scheduledFor
    ? DateTime.fromISO(detail.scheduledFor, { zone: "utc" }).setZone(ownerTimezone)
    : null;
  const scheduleSummary = scheduledLocal
    ? scheduledLocal.toFormat("cccc d LLLL yyyy · HH:mm")
    : "Pending";

  const nextAvailableSlot = DateTime.now().setZone(ownerTimezone).plus({ minutes: 15 }).startOf("minute");
  const initialSlot = (scheduledLocal ?? nextAvailableSlot).startOf("minute");
  const initialDate = (initialSlot.toISODate() ||
    nextAvailableSlot.toISODate() ||
    DateTime.now().setZone(ownerTimezone).toISODate() ||
    new Date().toISOString().slice(0, 10)) as string;
  const initialTime = initialSlot.toFormat("HH:mm");

  const designStatus = toDesignStatus(detail.status);
  const isFailed = detail.status === "failed" || Boolean(detail.lastError);
  const providerResponse = detail.providerResponse ? JSON.stringify(detail.providerResponse, null, 2) : null;
  const lastAttemptedLabel = detail.lastAttemptedAt ? new Date(detail.lastAttemptedAt).toLocaleString() : null;
  const countdown = scheduledLocal && scheduledLocal > DateTime.now() ? relativeCountdown(scheduledLocal) : null;
  const words = wordCount(detail.body);
  const heroImage = detail.media.length > 0 ? detail.media[0] : null;
  const campaignName = detail.campaign?.name ?? "Instant post";
  const venueName = campaignName !== "Instant post" ? campaignName : "Your Venue";

  return (
    <div className="flex flex-col gap-6 h-full font-sans" style={{ color: "var(--c-ink)" }}>
      {/* ---- Breadcrumb ---- */}
      <nav className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/planner" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to planner
          </Link>
        </Button>
        <span style={{ color: "var(--c-ink-4)" }}>/</span>
        {scheduledLocal ? (
          <span className="text-[13px]" style={{ color: "var(--c-ink-3)" }}>
            {scheduledLocal.toFormat("d LLL yyyy · HH:mm")}
          </span>
        ) : (
          <span className="text-[13px]" style={{ color: "var(--c-ink-3)" }}>
            Unscheduled
          </span>
        )}
      </nav>

      {/* ---- Header area ---- */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <PlatformDot platform={detail.platform} size={28} />
          <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>
            {formatPlatformLabel(detail.platform)} · {detail.placement === "story" ? "Story" : "Feed post"}
          </span>
          <Status status={designStatus} size="sm" />
        </div>
        <h1 className="text-[19px] font-semibold leading-snug">{campaignName}</h1>
        <p className="text-[13px]" style={{ color: "var(--c-ink-3)" }}>
          {detail.placement === "story" ? "Story" : "Instant post"}
          {countdown && (
            <>
              {" · Will go out in "}
              <span className="mono">{countdown}</span>
            </>
          )}
        </p>
      </header>

      {/* ---- Recovery card (failed state) ---- */}
      {isFailed && (
        <section
          className="grid gap-6"
          style={{
            gridTemplateColumns: "auto 1fr",
            backgroundColor: "var(--c-card-raised)",
            border: "1px solid var(--c-line-2)",
            borderRadius: 18,
            padding: 28,
            boxShadow: "var(--sh-sm)",
          }}
        >
          {/* Alert icon */}
          <div
            className="flex items-center justify-center rounded-full shrink-0"
            style={{
              width: 56,
              height: 56,
              backgroundColor: "var(--c-claret-soft)",
            }}
          >
            <AlertTriangle style={{ color: "var(--c-claret)", width: 24, height: 24 }} />
          </div>

          {/* Recovery content */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--c-ink)" }}>
                {formatPlatformLabel(detail.platform)} couldn&apos;t accept this post.
              </h2>
              <p className="text-[15px]" style={{ color: "var(--c-ink-2)" }}>
                {detail.lastError
                  ? detail.lastError
                  : "Something went wrong when we tried to publish. You can reconnect the platform, try publishing again, or download your content to post manually."}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="md" icon={Link2}>
                Reconnect {formatPlatformLabel(detail.platform)}
              </Button>
              <Button variant="secondary" size="md" icon={RefreshCw}>
                Try again now
              </Button>
              <Button variant="ghost" size="md" icon={Download}>
                Download copy &amp; image
              </Button>
            </div>

            {/* Diagnostic footer */}
            <div
              className="flex flex-wrap items-center gap-6 pt-4"
              style={{ borderTop: "1px dashed var(--c-line)" }}
            >
              {lastAttemptedLabel && (
                <div className="flex flex-col gap-0.5">
                  <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Last tried</span>
                  <span className="mono text-[12px]" style={{ color: "var(--c-ink-2)" }}>
                    {lastAttemptedLabel}
                  </span>
                </div>
              )}
              {providerResponse && (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Error code</span>
                    <span className="mono text-[12px]" style={{ color: "var(--c-ink-2)" }}>
                      {detail.providerResponse && typeof detail.providerResponse === "object" && "code" in detail.providerResponse
                        ? String(detail.providerResponse.code)
                        : "—"}
                    </span>
                  </div>
                  <ProviderResponseDisclosure response={providerResponse} />
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- 2-column layout ---- */}
      <div
        className="grid gap-5 mx-auto w-full"
        style={{ gridTemplateColumns: "1fr 1fr", maxWidth: 1200 }}
      >
        {/* Left column — Caption editor */}
        <div
          style={{
            backgroundColor: "var(--c-card-raised)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            padding: 24,
            boxShadow: "var(--sh-sm)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Caption</span>
            <span className="mono text-[12px]" style={{ color: "var(--c-ink-3)" }}>
              {words} {words === 1 ? "word" : "words"}
            </span>
          </div>

          <PlannerContentComposer
            key={`${detail.id}:${detail.status}:${detail.scheduledFor ?? "pending"}:${detail.media.map((media) => media.id).join(",")}:${detail.body}`}
            detail={detail}
            ownerTimezone={ownerTimezone}
            mediaLibrary={mediaLibrary}
          />

          {!isFailed && (
            <div className="flex items-center gap-2 mt-4">
              <Button variant="ghost" size="sm" icon={RefreshCw}>
                Regenerate
              </Button>
              <Button variant="ghost" size="sm">
                Try a different angle
              </Button>
            </div>
          )}
        </div>

        {/* Right column — Preview */}
        <div
          style={{
            backgroundColor: "var(--c-card-raised)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            padding: 0,
            overflow: "hidden",
            boxShadow: "var(--sh-sm)",
          }}
        >
          {/* Mock social post header */}
          <div className="flex items-center gap-3 p-4" style={{ borderBottom: "1px solid var(--c-line)" }}>
            <div
              className="flex items-center justify-center rounded-full shrink-0 text-white font-semibold text-[14px]"
              style={{ width: 36, height: 36, backgroundColor: "var(--c-orange)" }}
            >
              {venueName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] font-semibold" style={{ color: "var(--c-ink)" }}>
                {venueName}
              </span>
              <span className="text-[11px]" style={{ color: "var(--c-ink-3)" }}>
                Posting · {scheduledLocal ? scheduledLocal.toFormat("d LLL yyyy") : "Not scheduled"}
              </span>
            </div>
          </div>

          {/* Caption text */}
          <div className="px-4 pt-3 pb-3">
            <p
              className="text-[14px] leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--c-ink)", lineHeight: 1.5 }}
            >
              {detail.body || "No caption written yet."}
            </p>
          </div>

          {/* Hero image */}
          {heroImage && (
            heroImage.mediaType === "image" ? (
              <MediaFrameImage
                src={heroImage.url}
                alt="Post media"
                placement={detail.placement}
                size="full"
                className="mb-4"
                sizes="(max-width: 768px) 100vw, 640px"
              />
            ) : (
              <MediaFrameVideo
                src={heroImage.url}
                placement={detail.placement}
                size="full"
                className="mb-4"
                controls
              />
            )
          )}
        </div>
      </div>

      {/* ---- 3-up info grid ---- */}
      <div className="grid gap-3.5 mx-auto w-full" style={{ gridTemplateColumns: "1fr 1fr 1fr", maxWidth: 1200 }}>
        {/* Schedule card */}
        <div
          style={{
            backgroundColor: "var(--c-card)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            padding: 18,
          }}
        >
          <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Schedule</span>
          <p className="text-[14px] font-medium mt-2" style={{ color: "var(--c-ink)" }}>
            {scheduleSummary}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--c-ink-3)" }}>
            {ownerTimezoneLabel}
          </p>

          <div className="mt-3">
            <PlannerContentScheduleForm
              contentId={detail.id}
              initialDate={initialDate}
              initialTime={initialTime}
              timezone={ownerTimezone}
              timezoneLabel={ownerTimezoneLabel}
              status={detail.status}
              returnToPlannerAfterSave={false}
            />
          </div>
        </div>

        {/* Media card */}
        <div
          style={{
            backgroundColor: "var(--c-card)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            padding: 18,
          }}
        >
          <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Media</span>
          {detail.media.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {detail.media.map((m) => (
                m.mediaType === "image" ? (
                  <MediaFrameImage
                    key={m.id}
                    src={m.url}
                    alt={m.fileName ?? "Media"}
                    placement={detail.placement}
                    size="thumb"
                    sizes="80px"
                  />
                ) : (
                  <MediaFrameVideo
                    key={m.id}
                    src={m.url}
                    placement={detail.placement}
                    size="thumb"
                    controls
                  />
                )
              ))}
            </div>
          ) : (
            <p className="text-[13px] mt-2" style={{ color: "var(--c-ink-3)" }}>
              No media attached
            </p>
          )}
          <div className="mt-3">
            <Button variant="ghost" size="sm">
              Swap media
            </Button>
          </div>
        </div>

        {/* Belongs-to card */}
        <div
          style={{
            backgroundColor: "var(--c-card)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            padding: 18,
          }}
        >
          <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Belongs to</span>
          <p className="text-[14px] font-medium mt-2" style={{ color: "var(--c-ink)" }}>
            {detail.campaign?.name ?? "Instant post"}
          </p>
          {!detail.campaign?.name && (
            <p className="text-[12px] mt-0.5" style={{ color: "var(--c-ink-3)" }}>
              Not part of a campaign
            </p>
          )}
          {detail.campaign?.id && (
            <div className="mt-3">
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/campaigns/${detail.campaign.id}`}>View campaign</Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ---- Footer actions ---- */}
      <footer
        className="flex items-center justify-between mx-auto w-full pb-8"
        style={{ maxWidth: 1200 }}
      >
        <Button variant="danger" size="md" icon={Trash2}>
          Cancel this post
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md">
            Save changes
          </Button>
          <Button variant="amber" size="md" icon={Play}>
            Publish now
          </Button>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider response disclosure (client island)                       */
/* ------------------------------------------------------------------ */

function ProviderResponseDisclosure({ response }: { response: string }) {
  return (
    <details className="group">
      <summary
        className="inline-flex items-center gap-1 cursor-pointer text-[12px] font-medium"
        style={{ color: "var(--c-ink-2)" }}
      >
        Show provider response
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
      </summary>
      <pre
        className="mt-3 overflow-x-auto text-[11px] mono leading-relaxed p-4 rounded-lg"
        style={{
          backgroundColor: "var(--c-paper-2)",
          border: "1px solid var(--c-line)",
          color: "var(--c-ink-2)",
        }}
      >
        {response}
      </pre>
    </details>
  );
}
