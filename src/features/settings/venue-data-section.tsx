"use client";

import { useState, useTransition, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { requestVenueClosure } from "@/app/(app)/settings/venue-data-actions";
import { requestExportDownload, saveDownload } from "@/lib/export/download-request";
import { CONTACT } from "@/lib/legal/company";
import { CLOSURE_STEPS, OWNER_DATA_MESSAGES, OWNER_EXPORT_PATH, OWNER_EXPORTS_PER_DAY } from "@/lib/settings/owner-data";
import { formatUkDateTime } from "@/lib/utils/date";

/**
 * Settings, "Your data and closing this venue" (tasks/SPEC-self-serve-signup.md,
 * section 5, "Later (P10)"). The page renders it only for owners while
 * self-serve sign-up is on; the export route and the closure action check both
 * again on the server.
 */

interface VenueDataSectionProps {
  /** The brand this page was rendered for; the server refuses if the active brand has changed since. */
  accountId: string;
}

type Notice = { tone: "error" | "success"; text: string } | null;

type ClosureState =
  | { step: "idle" }
  | { step: "confirming" }
  | { step: "sent"; requestedAt: string; alreadyRequested: boolean; confirmationSent: boolean };

function NoticeBox({ notice }: { notice: Notice }): ReactElement | null {
  if (!notice) return null;
  const style =
    notice.tone === "error"
      ? { backgroundColor: "var(--c-claret-soft)", color: "var(--c-claret)" }
      : { backgroundColor: "var(--c-status-posted-bg)", color: "var(--c-status-posted-fg)" };
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} className="rounded-[var(--r-md)] p-3 text-sm" style={style}>
      {notice.text}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
      {children}
    </p>
  );
}

function ClosureSteps(): ReactElement {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: "var(--c-ink)" }}>
      {CLOSURE_STEPS.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

function sentMessage(state: Extract<ClosureState, { step: "sent" }>): string {
  const when = formatUkDateTime(state.requestedAt);
  if (state.alreadyRequested) {
    return `An owner of this venue asked us to close it${when ? ` on ${when}` : ""}. We have that request, so we have not sent another email. To change your mind, email ${CONTACT.email}.`;
  }
  return state.confirmationSent
    ? "We have your request and have emailed you a confirmation. Nothing changes until we close the venue."
    : `We have your request, but we could not email you a confirmation. Nothing changes until we close the venue. To check, email ${CONTACT.email}.`;
}

export function VenueDataSection({ accountId }: VenueDataSectionProps): ReactElement {
  const [isExporting, startExport] = useTransition();
  const [isSending, startSending] = useTransition();
  const [exportNotice, setExportNotice] = useState<Notice>(null);
  const [closureNotice, setClosureNotice] = useState<Notice>(null);
  const [closure, setClosure] = useState<ClosureState>({ step: "idle" });

  function downloadData() {
    startExport(async () => {
      setExportNotice(null);
      const result = await requestExportDownload(OWNER_EXPORT_PATH, accountId, {
        failed: OWNER_DATA_MESSAGES.exportFailed,
        signedOut: OWNER_DATA_MESSAGES.signedOut,
      });
      if (!result.ok) {
        setExportNotice({ tone: "error", text: result.error });
        return;
      }
      saveDownload(result.blob, result.fileName);
      setExportNotice({ tone: "success", text: "Your download has started." });
    });
  }

  function sendClosureRequest() {
    startSending(async () => {
      setClosureNotice(null);
      try {
        const result = await requestVenueClosure({ accountId });
        if (!result.success || !result.requestedAt) {
          setClosureNotice({ tone: "error", text: result.error ?? OWNER_DATA_MESSAGES.closureFailed });
          return;
        }
        setClosure({
          step: "sent",
          requestedAt: result.requestedAt,
          alreadyRequested: result.alreadyRequested === true,
          confirmationSent: result.confirmationSent !== false,
        });
      } catch {
        setClosureNotice({ tone: "error", text: OWNER_DATA_MESSAGES.closureFailed });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>
          Your data and closing this venue
        </h3>
        <Muted>Only owners see this.</Muted>
      </div>

      <div className="space-y-3">
        <h4 className="text-base font-semibold" style={{ color: "var(--c-ink)" }}>
          Download my data
        </h4>
        <Muted>
          A file with your posts and schedule, brand settings, link-in-bio page and links to download your photos and
          videos. The photo and video links work for 7 days. It has no passwords or connection keys. You can download it{" "}
          {OWNER_EXPORTS_PER_DAY} times a day.
        </Muted>
        <Button type="button" variant="secondary" disabled={isExporting} onClick={downloadData} className="w-full sm:w-auto">
          {isExporting ? "Preparing your download..." : "Download my data"}
        </Button>
        <NoticeBox notice={exportNotice} />
      </div>

      <div className="space-y-3 border-t pt-6" style={{ borderColor: "var(--c-line)" }}>
        <h4 className="text-base font-semibold" style={{ color: "var(--c-ink)" }}>
          Close this venue
        </h4>
        {closure.step === "idle" ? (
          <>
            <Muted>
              Ask us to close this venue on Cheers. Nothing is stopped or deleted straight away: we check with you first.
            </Muted>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setClosureNotice(null);
                setClosure({ step: "confirming" });
              }}
              className="w-full sm:w-auto"
            >
              Ask us to close this venue
            </Button>
          </>
        ) : null}

        {closure.step === "confirming" ? (
          <div className="space-y-3">
            <p className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>
              What happens next
            </p>
            <ClosureSteps />
            <Muted>Nothing changes until we close the venue. We will email you a confirmation of your request.</Muted>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="danger" disabled={isSending} onClick={sendClosureRequest} className="w-full sm:w-auto">
                {isSending ? "Sending your request..." : "Send my request"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isSending}
                onClick={() => {
                  setClosureNotice(null);
                  setClosure({ step: "idle" });
                }}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {closure.step === "sent" ? (
          <div className="space-y-3">
            <NoticeBox notice={{ tone: "success", text: sentMessage(closure) }} />
            <p className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>
              What happens next
            </p>
            <ClosureSteps />
          </div>
        ) : null}

        <NoticeBox notice={closureNotice} />
      </div>
    </div>
  );
}
