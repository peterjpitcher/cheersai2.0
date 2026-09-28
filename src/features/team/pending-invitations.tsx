"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { acceptInvitation, declineInvitation } from "@/app/invitations/actions";
import type { BrandRole } from "@/lib/auth/types";

export interface PendingInvitationView {
  id: string;
  brandName: string;
  role: BrandRole;
  /** Already formatted on the server in London time, e.g. "5 October 2026". */
  expiresOn: string;
}

interface PendingInvitationsProps {
  invitations: PendingInvitationView[];
}

type Status = { kind: "success" | "error"; message: string } | null;

const ROLE_TEXT: Record<BrandRole, string> = {
  owner: "as an owner",
  member: "as a member",
};

/**
 * The signed-in person's open team invitations, each accepted or declined
 * explicitly. Accepting never switches brand: the person picks the new brand
 * from the brand switcher when they want it.
 */
export function PendingInvitations({ invitations }: PendingInvitationsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  function run(action: () => Promise<{ success?: boolean; error?: string }>, done: string) {
    setStatus(null);
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        setStatus({ kind: "success", message: done });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error ?? "We could not finish this. Please try again." });
      }
    });
  }

  return (
    <div className="space-y-4">
      {status ? (
        <div
          role={status.kind === "error" ? "alert" : "status"}
          className="rounded-[var(--r-md)] p-3 text-sm"
          style={
            status.kind === "error"
              ? { backgroundColor: "var(--c-claret-soft)", color: "var(--c-claret)" }
              : { backgroundColor: "var(--c-status-posted-bg)", color: "var(--c-status-posted-fg)" }
          }
        >
          {status.message}
          {status.kind === "success" ? (
            <>
              {" "}
              <Link href="/dashboard" className="font-medium underline">
                Go to Cheers
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {invitations.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          You have no invitations waiting.
        </p>
      ) : (
        <ul className="divide-y rounded-[var(--r-xl)] border" style={{ borderColor: "var(--c-line)" }}>
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>
                  {invitation.brandName}
                </p>
                <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                  Join {ROLE_TEXT[invitation.role]}. Expires {invitation.expiresOn}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => acceptInvitation(invitation.id),
                      `You now have access to ${invitation.brandName}. Pick it from the brand switcher.`,
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => run(() => declineInvitation(invitation.id), "Invitation declined.")}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
