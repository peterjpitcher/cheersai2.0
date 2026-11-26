"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, RefreshCw, Send, SkipForward } from "lucide-react";

import {
  editGoogleVersionWording,
  releaseGoogleVersion,
  retryGoogleVersion,
  skipGoogleVersion,
} from "@/app/(app)/planner/google-version-actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { GoogleVersionView } from "@/lib/google-posts/model";
import type { GooglePostSection } from "@/lib/google-posts/post-section";
import { GOOGLE_SUMMARY_MAX_CHARS } from "@/lib/google-posts/summary";
import {
  countGoogleCharacters,
  formatGoogleEventTimes,
  googleButtonLabel,
  googleModerationLabel,
  googleStateChip,
} from "@/lib/google-posts/view-text";

/**
 * The Google section of the planner post page (decision D12): where the
 * post's Google version is, its wording and details, and the buttons that
 * apply to it. Every change goes through the planner's Google actions, which
 * check the brand, the switch and the connection again on the server.
 */

type VisibleSection = Exclude<GooglePostSection, { kind: "hidden" }>;

interface GoogleVersionSectionProps {
  section: VisibleSection;
  timezone: string;
}

type ActionResult = { success?: boolean; error?: string; version?: GoogleVersionView };

const TRY_AGAIN = "Please try again.";

export function GoogleVersionSection({ section, timezone }: GoogleVersionSectionProps): React.JSX.Element {
  const version = section.kind === "ready" || section.kind === "reconnect" ? section.version : null;
  const chip = version ? googleStateChip(version) : null;

  return (
    <section
      aria-labelledby="google-version-heading"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 rounded-[var(--r-xl)] border border-[var(--c-line)] bg-[var(--c-card)] p-[18px] sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id="google-version-heading" className="eyebrow text-[var(--c-ink-3)]">
          Google
        </h2>
        {chip && (
          <span
            className="inline-flex h-[18px] items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase leading-none"
            style={{ color: `var(--c-status-${chip.tone}-fg)`, backgroundColor: `var(--c-status-${chip.tone}-bg)` }}
          >
            {chip.label}
          </span>
        )}
      </div>

      {section.kind === "unavailable" && (
        <p className="text-[14px] text-[var(--c-ink-2)]">
          We could not load the Google version just now. Refresh the page to try again.
        </p>
      )}

      {section.kind === "reconnect" && (
        <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--c-line-2)] bg-[var(--c-paper-2)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-[var(--c-ink-2)]">
            Google is not connected, or needs reconnecting, so this post cannot go to Google or be changed here.
          </p>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/connections" className="inline-flex shrink-0 items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5" />
              Go to Connections
            </Link>
          </Button>
        </div>
      )}

      {section.kind !== "unavailable" && !version && (
        <p className="text-[14px] text-[var(--c-ink-2)]">This post has no Google version.</p>
      )}

      {version && (
        <GoogleVersionBody
          key={`${version.state}:${version.summary}`}
          version={version}
          timezone={timezone}
          controls={section.kind === "ready"}
        />
      )}
    </section>
  );
}

interface GoogleVersionBodyProps {
  version: GoogleVersionView;
  timezone: string;
  /** False while Google needs reconnecting: the details show, the buttons do not. */
  controls: boolean;
}

function GoogleVersionBody({ version, timezone, controls }: GoogleVersionBodyProps): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState(version.summary);
  const [saved, setSaved] = useState(version.summary);

  const editable = controls && version.canEdit;
  const characters = countGoogleCharacters(draft);
  const overLimit = characters > GOOGLE_SUMMARY_MAX_CHARS;
  const canSave = editable && draft.trim().length > 0 && !overLimit && draft !== saved;
  const moderation = googleModerationLabel(version.googleState);
  const eventTimes = formatGoogleEventTimes(version.eventStart, version.eventEnd, timezone);
  // A person's Skip keeps the last problem on the row; the status line says all that matters then.
  const showLastError =
    version.state !== "skipped" && version.lastError !== null && version.lastError !== version.statusLine;

  const run = (failTitle: string, action: () => Promise<ActionResult>, onSuccess: (result: ActionResult) => void) => {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.success) {
          toast.error(failTitle, { description: result.error ?? TRY_AGAIN });
          router.refresh();
          return;
        }
        onSuccess(result);
        router.refresh();
      } catch {
        // A thrown server action reaches the browser as technical text: never show it.
        toast.error(failTitle, { description: TRY_AGAIN });
      }
    });
  };

  const handleSave = () => {
    run("Could not save the Google wording", () => editGoogleVersionWording({ contentId: version.contentItemId, summary: draft }), (result) => {
      const stored = result.version?.summary ?? draft;
      setDraft(stored);
      setSaved(stored);
      toast.success("Google wording saved", {
        description:
          stored === draft.trim()
            ? "It no longer follows the Facebook wording."
            : "Links, hashtags, handles and phone numbers were removed. It no longer follows the Facebook wording.",
      });
    });
  };

  const handleRelease = () => {
    run("Could not release it", () => releaseGoogleVersion({ contentId: version.contentItemId }), () => {
      toast.success("Released for Google", { description: "It will go to Google at the post's time, with this wording." });
    });
  };

  const handleRetry = () => {
    run("Could not try again", () => retryGoogleVersion({ contentId: version.contentItemId }), () => {
      toast.success("Back in the queue for Google", { description: "It will be tried again on the next Google run." });
    });
  };

  const handleSkip = () => {
    const confirmed = window.confirm("Skip the Google version of this post? It will not be sent to Google, and this cannot be undone.");
    if (!confirmed) return;
    run("Could not skip it", () => skipGoogleVersion({ contentId: version.contentItemId }), () => {
      toast.success("Google version skipped", { description: "The Facebook post is not affected." });
    });
  };

  const hasButtons = controls && (version.canRelease || version.canRetry || version.canSkip);
  // Release sends the wording as stored, so unsaved changes must be saved first.
  const unsaved = editable && draft !== saved;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium text-[var(--c-ink)]">{version.statusLine}</p>
        {showLastError && <p className="text-[13px] text-[var(--c-claret)]">{version.lastError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="google-wording" className="eyebrow text-[var(--c-ink-3)]">
            Google wording
          </label>
          {editable && (
            <span
              className={`mono text-[12px] ${overLimit ? "text-[var(--c-claret)]" : "text-[var(--c-ink-3)]"}`}
              aria-live="polite"
            >
              {characters.toLocaleString("en-GB")} / {GOOGLE_SUMMARY_MAX_CHARS.toLocaleString("en-GB")}
            </span>
          )}
        </div>
        {editable ? (
          <Textarea
            id="google-wording"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            disabled={isPending}
            aria-invalid={overLimit}
          />
        ) : (
          <p id="google-wording" className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--c-ink)]">
            {version.summary || "No wording yet."}
          </p>
        )}
        {editable && (
          <p className="text-[12px] text-[var(--c-ink-3)]">
            {version.wordingSource === "ai"
              ? "Written for Google by the AI from the Facebook post. It no longer follows the Facebook wording; edit it here if you want to change it."
              : version.summaryEdited
                ? "Set by hand (edited or released), so it no longer follows the Facebook wording."
                : version.wordingSource === "awaiting_ai"
                  ? "Follows the Facebook wording (without links, hashtags, handles or phone numbers) for now. Wording written for Google will replace it shortly, unless you edit it first."
                  : "Follows the Facebook wording (without links, hashtags, handles or phone numbers) until you edit it."}
            {overLimit && ` Google allows ${GOOGLE_SUMMARY_MAX_CHARS.toLocaleString("en-GB")} characters at most.`}
          </p>
        )}
        {editable && (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={handleSave} disabled={!canSave || isPending}>
              {isPending ? "Saving…" : "Save wording"}
            </Button>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="eyebrow text-[var(--c-ink-3)]">Type</dt>
          <dd className="text-[var(--c-ink)]">
            {version.topicType === "EVENT" ? (
              <>
                <span className="font-medium">Event{version.eventTitle ? `: ${version.eventTitle}` : ""}</span>
                {eventTimes && <span className="block text-[var(--c-ink-2)]">{eventTimes}</span>}
              </>
            ) : (
              "Update"
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="eyebrow text-[var(--c-ink-3)]">Button</dt>
          <dd className="min-w-0 text-[var(--c-ink)]">
            {version.button ? (
              <>
                <span className="font-medium">{googleButtonLabel(version.button.type)}</span>
                <a
                  href={version.button.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all text-[var(--c-ink-2)] underline underline-offset-2"
                >
                  {version.button.url}
                </a>
              </>
            ) : (
              "No button"
            )}
          </dd>
        </div>
        {moderation && (
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow text-[var(--c-ink-3)]">Google&apos;s check</dt>
            <dd className="text-[var(--c-ink)]">{moderation}</dd>
          </div>
        )}
        {version.googleUrl && (
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow text-[var(--c-ink-3)]">On Google</dt>
            <dd>
              <a
                href={version.googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[var(--c-ink)] underline underline-offset-2"
              >
                View the post on Google
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </dd>
          </div>
        )}
      </dl>

      {hasButtons && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-[var(--c-line)] pt-4">
          {version.canRelease && (
            <Button type="button" variant="primary" size="md" icon={Send} onClick={handleRelease} disabled={isPending || unsaved}>
              Release
            </Button>
          )}
          {version.canRelease && unsaved && (
            <span className="text-[12px] text-[var(--c-ink-3)]">Save the wording before releasing it.</span>
          )}
          {version.canRetry && (
            <Button type="button" variant="primary" size="md" icon={RefreshCw} onClick={handleRetry} disabled={isPending}>
              Retry
            </Button>
          )}
          {version.canSkip && (
            <Button type="button" variant="danger" size="md" icon={SkipForward} onClick={handleSkip} disabled={isPending}>
              Skip
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
