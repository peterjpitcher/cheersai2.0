"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelTeamInvitation,
  inviteTeamMember,
  removeTeamMember,
  setTeamMemberRole,
  type TeamMember,
} from "@/app/(app)/settings/team-actions";
import type { BrandRole } from "@/lib/auth/types";
import type { SentInvitation } from "@/lib/team/invitations";
import { formatUkLongDate } from "@/lib/utils/date";

interface TeamSectionProps {
  members: TeamMember[];
  /** Open invitations waiting to be accepted (each holds a seat); null when they could not be loaded. */
  invitations: SentInvitation[] | null;
  canManage: boolean;
}

const ROLE_LABELS: Record<BrandRole, string> = { owner: "Owner", member: "Member" };

/**
 * Team list for the active brand. Owners invite, remove and change roles, and
 * cancel invitations not yet accepted; members see the lists only. The server
 * actions re-check ownership.
 */
export function TeamSection({ members, invitations, canManage }: TeamSectionProps) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BrandRole>("member");

  function run(action: () => Promise<{ success?: boolean; error?: string }>, done: string, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        toast.success(done);
        onSuccess?.();
        router.refresh();
      } else {
        toast.error("That didn't work", { description: result.error ?? "Please try again." });
      }
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-[var(--r-xl)] border" style={{ borderColor: "var(--c-line)" }}>
        {members.map((member) => (
          <li key={member.userId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" style={{ color: "var(--c-ink)" }}>
                {member.email ?? "Unknown email"}
                {member.isYou ? " (you)" : ""}
              </p>
              <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                {ROLE_LABELS[member.role]}
              </p>
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    const next: BrandRole = member.role === "owner" ? "member" : "owner";
                    run(() => setTeamMemberRole(member.userId, next), `Now ${ROLE_LABELS[next].toLowerCase()}`);
                  }}
                >
                  {member.role === "owner" ? "Make member" : "Make owner"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    if (!window.confirm(`Remove ${member.email ?? "this person"} from this brand?`)) return;
                    run(() => removeTeamMember(member.userId), "Removed from the brand");
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : null}
          </li>
        ))}
        {members.length === 0 ? (
          <li className="p-3 text-sm" style={{ color: "var(--c-ink-3)" }}>
            No one else has access yet.
          </li>
        ) : null}
      </ul>

      {invitations === null ? (
        <p className="text-sm" role="alert" style={{ color: "var(--c-claret)" }}>
          Invitations waiting to be accepted could not be loaded. Reload the page to try again.
        </p>
      ) : invitations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>
            Waiting to accept
          </p>
          <ul className="divide-y rounded-[var(--r-xl)] border" style={{ borderColor: "var(--c-line)" }}>
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--c-ink)" }}>
                    {invitation.email ?? "Unknown email"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                    Invited as {ROLE_LABELS[invitation.role].toLowerCase()}. Expires {formatUkLongDate(invitation.expiresAt)}.
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      if (!window.confirm(`Cancel the invitation for ${invitation.email ?? "this person"}?`)) return;
                      run(() => cancelTeamInvitation(invitation.id), "Invitation cancelled");
                    }}
                  >
                    Cancel invitation
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => inviteTeamMember({ email, role }), "Invite sent", () => setEmail(""));
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="team-invite-email">Invite someone</Label>
            <Input
              id="team-invite-email"
              type="email"
              required
              placeholder="name@yourvenue.co.uk"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-invite-role">Role</Label>
            <select
              id="team-invite-role"
              className="h-10 rounded-[var(--r-xl)] border px-3 text-sm"
              style={{ borderColor: "var(--c-line)", backgroundColor: "var(--c-card)", color: "var(--c-ink)" }}
              value={role}
              onChange={(event) => setRole(event.target.value as BrandRole)}
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <Button type="submit" variant="primary" disabled={isPending || !email}>
            {isPending ? "Sending..." : "Send invite"}
          </Button>
        </form>
      ) : (
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          Only an owner can invite or remove people.
        </p>
      )}
    </div>
  );
}
