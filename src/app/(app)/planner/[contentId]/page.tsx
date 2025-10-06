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
      <div className="space-y-2">
        <Link href="/planner" className="text-xs font-semibold text-slate-500 hover:text-slate-700">
          ← Back to planner
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{detail.campaign?.name ?? "Untitled campaign"}</h1>
        <p className="text-sm text-slate-500">
          {formatPlatformLabel(detail.platform)} · {formatStatusLabel(detail.status)} · {scheduleSummary}
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Schedule</h2>
            <p className="text-sm text-slate-600">Current: {scheduleSummary} · {ownerTimezoneLabel}</p>
          </div>
        </header>
        <div className="mt-4">
          <PlannerContentScheduleForm
            contentId={detail.id}
            initialDate={initialDate}
            initialTime={initialTime}
            timezone={ownerTimezone}
            timezoneLabel={ownerTimezoneLabel}
            status={detail.status}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Post copy</h2>
          {detail.status === "draft" ? <ApproveDraftButton contentId={detail.id} /> : null}
        </header>
        <div className="mt-4">
          <PlannerContentBodyForm
            contentId={detail.id}
            initialBody={detail.body}
            status={detail.status}
          />
        </div>
      </section>

      {detail.media.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Current attachments</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {detail.media.map((media) => (
              <article
                key={media.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
              >
                <div className="bg-slate-900/5 p-3 text-xs font-medium uppercase tracking-wide text-slate-600">
                  {media.fileName ?? media.id}
                </div>
                <div className="flex h-48 w-full items-center justify-center bg-slate-200">
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
                <div className="flex items-center justify-between border-t border-slate-200 bg-white p-3 text-xs text-slate-600">
                  <span>{media.mediaType === "image" ? "Image" : "Video"}</span>
                  <a
                    href={media.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-slate-900 hover:text-slate-700"
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

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Metadata</h2>
        <dl className="mt-4 grid gap-2 text-sm text-slate-600">
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-slate-900">Auto-generated</dt>
            <dd>{detail.autoGenerated ? "Yes" : "No"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-slate-900">Scheduled for</dt>
            <dd>{scheduledMetadata}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-slate-900">Media attachments</dt>
            <dd>{detail.media.length ? detail.media.length : "None"}</dd>
          </div>
          {detail.promptContext ? (
            <div className="flex justify-between gap-4">
              <dt className="font-semibold text-slate-900">Prompt context keys</dt>
              <dd>{Object.keys(detail.promptContext).length}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
