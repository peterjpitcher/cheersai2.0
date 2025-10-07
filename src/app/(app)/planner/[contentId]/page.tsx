import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";

import { ApproveDraftButton } from "@/features/planner/approve-draft-button";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import { PlannerContentScheduleForm } from "@/features/planner/content-schedule-form";
import { PlannerContentBodyForm } from "@/features/planner/content-body-form";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { getPlannerContentDetail } from "@/lib/planner/data";
import { listMediaAssets } from "@/lib/library/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export default async function PlannerContentPage({
  params,
}: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  const detail = await getPlannerContentDetail(contentId);

  if (!detail) {
    notFound();
  }

  const mediaLibrary = await listMediaAssets();
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

  const scheduledMetadata = scheduledLocal
    ? `${scheduleSummary} (${ownerTimezoneLabel})`
    : scheduleSummary;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <Link
          href="/planner"
          className="inline-flex items-center text-xs font-semibold text-white/80 transition hover:text-white"
        >
          ← Back to planner
        </Link>
        <h1 className="text-2xl font-semibold text-white">{detail.campaign?.name ?? "Untitled campaign"}</h1>
        <p className="text-sm text-white/80">
          {formatPlatformLabel(detail.platform)} · {formatStatusLabel(detail.status)} · {scheduleSummary}
        </p>
      </section>

      {detail.lastError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-lg">
          <h2 className="text-sm font-semibold text-rose-800">Publish attempt failed</h2>
          <p className="mt-1">{detail.lastError}</p>
          {detail.lastAttemptedAt ? (
            <p className="mt-2 text-xs text-rose-600">Last attempt: {new Date(detail.lastAttemptedAt).toLocaleString()}</p>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Schedule</h2>
            <p className="text-sm text-brand-teal/70">Current: {scheduleSummary} · {ownerTimezoneLabel}</p>
          </div>
        </header>
        <PlannerContentScheduleForm
          contentId={detail.id}
          initialDate={initialDate}
          initialTime={initialTime}
          timezone={ownerTimezone}
          timezoneLabel={ownerTimezoneLabel}
          status={detail.status}
        />
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Post copy</h2>
          {detail.status === "draft" ? <ApproveDraftButton contentId={detail.id} /> : null}
        </header>
        <PlannerContentBodyForm
          contentId={detail.id}
          initialBody={detail.body}
          status={detail.status}
        />
      </section>

      {detail.media.length ? (
        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
          <h2 className="text-lg font-semibold">Current attachments</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {detail.media.map((media) => (
              <article
                key={media.id}
                className="overflow-hidden rounded-2xl border border-brand-mist/60 bg-brand-mist/20 shadow-sm"
              >
                <div className="bg-brand-teal/10 p-3 text-xs font-medium uppercase tracking-wide text-brand-teal/70">
                  {media.fileName ?? media.id}
                </div>
                <div className="flex h-48 w-full items-center justify-center bg-white">
                  {media.mediaType === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.url} alt={media.fileName ?? "Campaign media"} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <video
                      src={media.url}
                      controls
                      className="max-h-full max-w-full object-contain"
                      preload="metadata"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-brand-mist/60 bg-white/90 p-3 text-xs text-brand-teal/70">
                  <span className="font-medium text-brand-teal">
                    {media.mediaType === "image" ? "Image" : "Video"}
                  </span>
                  <a
                    href={media.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-brand-ambergold hover:text-brand-ambergold/80"
                  >
                    Open
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <PlannerContentMediaEditor
        contentId={detail.id}
        initialMedia={detail.media.map((media) => ({ id: media.id, mediaType: media.mediaType, fileName: media.fileName }))}
        mediaLibrary={mediaLibrary}
      />

      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <h2 className="text-lg font-semibold">Metadata</h2>
        <dl className="grid gap-2 text-sm text-brand-teal/80">
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-brand-teal">Auto-generated</dt>
            <dd>{detail.autoGenerated ? "Yes" : "No"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-brand-teal">Scheduled for</dt>
            <dd>{scheduledMetadata}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-brand-teal">Media attachments</dt>
            <dd>{detail.media.length ? detail.media.length : "None"}</dd>
          </div>
          {detail.promptContext ? (
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-brand-teal">Prompt context keys</dt>
              <dd>{Object.keys(detail.promptContext).length}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
