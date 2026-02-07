import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";

import { PlannerContentScheduleForm } from "@/features/planner/content-schedule-form";
import { PlannerContentComposer } from "@/features/planner/planner-content-composer";
import { formatPlatformLabel, formatStatusLabel } from "@/features/planner/utils";
import { getPlannerContentDetail } from "@/lib/planner/data";
import { listMediaAssets } from "@/lib/library/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { PageHeader } from "@/components/layout/PageHeader";

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
  const detailSummary = `${formatPlatformLabel(detail.platform)} · ${detail.placement === "story" ? "Story" : "Feed post"} · ${formatStatusLabel(detail.status)} · ${scheduleSummary}`;
  const providerResponse = detail.providerResponse ? JSON.stringify(detail.providerResponse, null, 2) : null;
  const lastAttemptedLabel = detail.lastAttemptedAt ? new Date(detail.lastAttemptedAt).toLocaleString() : null;
  const showDiagnostics = Boolean(providerResponse || lastAttemptedLabel);

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title={detail.campaign?.name ?? "Untitled campaign"}
        description={detailSummary}
        action={
          <Link
            href="/planner"
            className="text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          >
            ← Back to planner
          </Link>
        }
      />

      {detail.lastError ? (
        <div className="rounded-xl border border-rose-200/70 bg-rose-50/80 px-5 py-4 text-sm text-rose-800 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
          <h2 className="text-sm font-semibold">Publish attempt failed</h2>
          <p className="mt-1">{detail.lastError}</p>
          {detail.lastAttemptedAt ? (
            <p className="mt-2 text-xs text-rose-700 dark:text-rose-200/80">Last attempt: {new Date(detail.lastAttemptedAt).toLocaleString()}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PlannerContentComposer
          key={`${detail.id}:${detail.status}:${detail.scheduledFor ?? "pending"}:${detail.media.map((media) => media.id).join(",")}:${detail.body}`}
          detail={detail}
          ownerTimezone={ownerTimezone}
          mediaLibrary={mediaLibrary}
        />

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="space-y-4 rounded-xl border border-white/20 bg-white/60 p-5 shadow-sm backdrop-blur-sm dark:bg-slate-900/60">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Schedule</h2>
              <p className="text-sm text-muted-foreground">Current: {scheduleSummary} · {ownerTimezoneLabel}</p>
            </header>
            <PlannerContentScheduleForm
              contentId={detail.id}
              initialDate={initialDate}
              initialTime={initialTime}
              timezone={ownerTimezone}
              timezoneLabel={ownerTimezoneLabel}
              status={detail.status}
              returnToPlannerAfterSave={false}
            />
          </section>

          <section className="space-y-4 rounded-xl border border-white/20 bg-white/60 p-5 shadow-sm backdrop-blur-sm dark:bg-slate-900/60">
            <h2 className="text-lg font-semibold text-foreground">Metadata</h2>
            <dl className="grid gap-2 text-sm text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-foreground">Auto-generated</dt>
                <dd>{detail.autoGenerated ? "Yes" : "No"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-foreground">Scheduled for</dt>
                <dd>{scheduledMetadata}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-foreground">Media attachments</dt>
                <dd>{detail.media.length ? detail.media.length : "None"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-foreground">Placement</dt>
                <dd className="capitalize">{detail.placement}</dd>
              </div>
              {detail.promptContext ? (
                <div className="flex justify-between gap-4">
                  <dt className="font-semibold text-foreground">Prompt context keys</dt>
                  <dd>{Object.keys(detail.promptContext).length}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {showDiagnostics ? (
            <details className="rounded-xl border border-white/20 bg-white/60 p-5 shadow-sm backdrop-blur-sm dark:bg-slate-900/60">
              <summary className="cursor-pointer list-none text-lg font-semibold text-foreground">Publish diagnostics</summary>
              <div className="mt-3 space-y-3">
                {lastAttemptedLabel ? (
                  <p className="text-sm text-muted-foreground">Last attempt: {lastAttemptedLabel}</p>
                ) : null}
                {providerResponse ? (
                  <pre className="overflow-x-auto rounded-lg border border-white/30 bg-white/80 p-3 text-xs text-foreground dark:bg-slate-900/70">
                    {providerResponse}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No provider response recorded yet.</p>
                )}
              </div>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
