import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, KeyRound } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { listPlannerNotifications } from "@/lib/planner/notifications";
import { PageHeader } from "@/components/layout/PageHeader";

const CATEGORY_PRESENTERS: Record<string, { label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; tone: string }> = {
  publish_success: {
    label: "Publish success",
    icon: CheckCircle2,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  story_publish_succeeded: {
    label: "Story published",
    icon: CheckCircle2,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  publish_failed: {
    label: "Publish failed",
    icon: AlertTriangle,
    tone: "border-rose-200 bg-rose-50 text-rose-900",
  },
  story_publish_failed: {
    label: "Story failed",
    icon: AlertTriangle,
    tone: "border-rose-200 bg-rose-50 text-rose-900",
  },
  story_publish_retry: {
    label: "Story retry scheduled",
    icon: AlertTriangle,
    tone: "border-amber-200 bg-amber-50 text-amber-900",
  },
  connection_needs_action: {
    label: "Connection issue",
    icon: AlertTriangle,
    tone: "border-amber-200 bg-amber-50 text-amber-900",
  },
  connection_metadata_updated: {
    label: "Metadata updated",
    icon: KeyRound,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  connection_reconnected: {
    label: "Connection restored",
    icon: CheckCircle2,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  weekly_materialised: {
    label: "Weekly plan",
    icon: Info,
    tone: "border-slate-200 bg-white text-slate-700",
  },
};

function resolvePresenter(category: string | null | undefined) {
  if (!category) {
    return {
      label: "System message",
      icon: Info,
      tone: "border-slate-200 bg-white text-slate-700",
    };
  }
  return CATEGORY_PRESENTERS[category] ?? {
    label: category.replace(/_/g, " "),
    icon: Info,
    tone: "border-slate-200 bg-white text-slate-700",
  };
}

export default async function PlannerNotificationsPage() {
  const notifications = await listPlannerNotifications();

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Notification history"
        description="Recent automation events, publish outcomes, and alerts. Entries drop off after 50 items."
        action={
          <Link href="/planner" className="text-sm font-semibold text-muted-foreground underline hover:text-foreground">
            Back to planner
          </Link>
        }
      />
      <div className="rounded-xl border border-white/20 bg-white/60 p-4 md:p-6 shadow-sm backdrop-blur-sm dark:bg-slate-900/60">
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/30 bg-white/70 p-6 text-sm text-muted-foreground backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/60">
              No notifications recorded yet.
            </p>
          ) : null}
          {notifications.map((notification) => {
            const presenter = resolvePresenter(notification.category);
            const Icon = presenter.icon;
            const meta = notification.metadata ?? {};

            return (
              <article
                key={notification.id}
                className={`rounded-xl border p-5 shadow-sm backdrop-blur-sm ${presenter.tone}`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/60">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-foreground">{presenter.label}</p>
                    <p className="text-muted-foreground">{notification.message}</p>
                    {Object.keys(meta).length ? (
                      <pre className="mt-2 overflow-auto rounded-lg bg-slate-900/5 p-3 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-200">
                        {JSON.stringify(meta, null, 2)}
                      </pre>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Logged {new Date(notification.createdAt).toLocaleString()}
                      {notification.readAt ? ` · dismissed ${new Date(notification.readAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
