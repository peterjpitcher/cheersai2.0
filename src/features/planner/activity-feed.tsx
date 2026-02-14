"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, KeyRound } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { DismissNotificationButton } from "@/features/planner/dismiss-notification-button";

const LEVEL_STYLES = {
  info: "border-brand-mist/60 bg-brand-mist/10",
  warning: "border-brand-caramel/50 bg-brand-caramel/10",
  error: "border-rose-300 bg-rose-50",
} as const;

const PROVIDER_LABELS: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business",
  gbp: "Google Business Profile",
};

export type PlannerActivityItem = {
  id: string;
  message: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  category?: string | null;
  metadata?: Record<string, unknown> | null;
  readAt?: string | null;
};

type Presenter = {
  containerClass: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClass: string;
  badge: string;
  message: string;
  details?: string;
  action?: { href: string; label: string };
};

type FetchMode = "initial" | "refresh";

const DEFAULT_LIMIT = 6;
const ACTIVITY_ENDPOINT = "/api/planner/activity";

const buildActivityUrl = (limit: number) => {
  const params = new URLSearchParams({ limit: String(limit) });
  return `${ACTIVITY_ENDPOINT}?${params.toString()}`;
};

export function PlannerActivityFeed() {
  const [activity, setActivity] = useState<PlannerActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(
    async (mode: FetchMode = "refresh") => {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetch(buildActivityUrl(DEFAULT_LIMIT), {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Activity request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as { activity?: PlannerActivityItem[] };
        setActivity(Array.isArray(payload.activity) ? payload.activity : []);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load recent activity.";
        setError(message);
      } finally {
        if (mode === "initial") {
          setLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const handleDismiss = useCallback((notificationId: string) => {
    setActivity((previous) => previous.filter((item) => item.id !== notificationId));
  }, []);

  let content: React.ReactNode;

  if (loading) {
    content = <div className="px-4 py-3 text-xs text-brand-teal/70">Loading recent activity…</div>;
  } else if (error) {
    content = (
      <article className="rounded-2xl border border-brand-caramel/40 bg-brand-caramel/10 px-4 py-3 text-sm text-brand-caramel">
        <p className="font-semibold">We could not load your activity feed.</p>
        <p className="mt-1 text-xs text-brand-caramel/80">{error}</p>
        <button
          type="button"
          onClick={() => load("initial")}
          className="mt-3 rounded-full border border-brand-caramel px-3 py-1 text-xs font-semibold text-brand-caramel transition hover:bg-brand-caramel hover:text-white"
        >
          Try again
        </button>
      </article>
    );
  } else if (!activity.length) {
    content = (
      <article className="rounded-2xl border border-brand-mist/60 bg-white/95 px-4 py-5 text-sm text-brand-teal">
        <p className="font-semibold text-brand-teal">You&apos;re all caught up.</p>
        <p className="mt-1 text-brand-teal/70">We&apos;ll surface new publishing updates here as they arrive.</p>
      </article>
    );
  } else {
    content = activity.map((item) => <ActivityCard key={item.id} item={item} onDismiss={handleDismiss} />);
  }

  return (
    <div className="space-y-3">
      {content}
      {!loading ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => load("refresh")}
            disabled={isRefreshing}
            className="rounded-full border border-brand-mist/60 px-3 py-1 text-xs font-semibold text-brand-teal transition hover:border-brand-teal hover:text-brand-caramel disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <Link
            href="/planner/notifications"
            className="ml-auto text-right text-xs font-semibold text-brand-teal/70 underline-offset-4 transition hover:text-brand-teal"
          >
            View full history
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function resolvePresenter(item: PlannerActivityItem): Presenter {
  const defaultPresenter: Presenter = {
    containerClass: LEVEL_STYLES[item.level],
    Icon: item.level === "error" ? AlertTriangle : item.level === "warning" ? AlertTriangle : Info,
    iconClass:
      item.level === "error"
        ? "bg-rose-100 text-rose-700"
        : item.level === "warning"
          ? "bg-brand-caramel/20 text-brand-caramel"
          : "bg-brand-mist/30 text-brand-teal",
    badge: item.level === "error" ? "Action required" : item.level === "warning" ? "Heads up" : "Activity",
    message: item.message,
  };

  if (!item.category) {
    return defaultPresenter;
  }

  switch (item.category) {
    case "publish_success":
      return {
        containerClass: "border-emerald-200 bg-emerald-50/60",
        Icon: CheckCircle2,
        iconClass: "bg-emerald-100 text-emerald-700",
        badge: "Publish success",
        message: item.message,
        action: buildContentAction(item.metadata, "View post"),
      };
    case "story_publish_succeeded":
      return {
        containerClass: "border-emerald-200 bg-emerald-50/60",
        Icon: CheckCircle2,
        iconClass: "bg-emerald-100 text-emerald-700",
        badge: "Story published",
        message: item.message,
        action: buildContentAction(item.metadata, "View story"),
      };
    case "publish_retry": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const detailParts: string[] = [];
      if (typeof metadata.nextAttemptAt === "string") {
        detailParts.push(`Next attempt ${new Date(metadata.nextAttemptAt).toLocaleString()}`);
      }
      if (Number.isFinite(Number(metadata.attempt))) {
        detailParts.push(`Attempt ${Number(metadata.attempt)}`);
      }
      if (typeof metadata.error === "string" && metadata.error.length) {
        detailParts.push(metadata.error);
      }
      return {
        containerClass: LEVEL_STYLES.warning,
        Icon: AlertTriangle,
        iconClass: "bg-brand-caramel/20 text-brand-caramel",
        badge: "Retry scheduled",
        message: item.message,
        details: detailParts.join(" · ") || undefined,
        action: buildContentAction(metadata, "View post"),
      };
    }
    case "story_publish_retry": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const detailParts: string[] = [];
      if (typeof metadata.nextAttemptAt === "string") {
        detailParts.push(`Next attempt ${new Date(metadata.nextAttemptAt).toLocaleString()}`);
      }
      if (Number.isFinite(Number(metadata.attempt))) {
        detailParts.push(`Attempt ${Number(metadata.attempt)}`);
      }
      if (typeof metadata.error === "string" && metadata.error.length) {
        detailParts.push(metadata.error);
      }
      return {
        containerClass: LEVEL_STYLES.warning,
        Icon: AlertTriangle,
        iconClass: "bg-brand-caramel/20 text-brand-caramel",
        badge: "Story retry",
        message: item.message,
        details: detailParts.join(" · ") || undefined,
        action: buildContentAction(metadata, "View story"),
      };
    }
    case "publish_failed": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const detailParts: string[] = [];
      if (Number.isFinite(Number(metadata.attempt))) {
        detailParts.push(`Attempt ${Number(metadata.attempt)}`);
      }
      if (typeof metadata.error === "string" && metadata.error.length) {
        detailParts.push(metadata.error);
      }
      return {
        containerClass: LEVEL_STYLES.error,
        Icon: AlertTriangle,
        iconClass: "bg-rose-100 text-rose-700",
        badge: "Publish failed",
        message: item.message,
        details: detailParts.join(" · ") || undefined,
        action: buildContentAction(metadata, "Review post"),
      };
    }
    case "story_publish_failed": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const detailParts: string[] = [];
      if (Number.isFinite(Number(metadata.attempt))) {
        detailParts.push(`Attempt ${Number(metadata.attempt)}`);
      }
      if (typeof metadata.error === "string" && metadata.error.length) {
        detailParts.push(metadata.error);
      }
      return {
        containerClass: LEVEL_STYLES.error,
        Icon: AlertTriangle,
        iconClass: "bg-rose-100 text-rose-700",
        badge: "Story failed",
        message: item.message,
        details: detailParts.join(" · ") || undefined,
        action: buildContentAction(metadata, "Review story"),
      };
    }
    case "media_derivative_skipped": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const reason = typeof metadata.reason === "string" ? metadata.reason : undefined;
      const detail =
        reason === "unsupported_media_type"
          ? "Video derivatives are skipped until video processing lands."
          : undefined;
      const assetId = typeof metadata.assetId === "string" ? metadata.assetId : undefined;
      return {
        containerClass: LEVEL_STYLES.warning,
        Icon: AlertTriangle,
        iconClass: "bg-brand-caramel/20 text-brand-caramel",
        badge: "Media derivatives",
        message: item.message,
        details: detail,
        action: { href: assetId ? `/library?asset=${assetId}` : "/library", label: "Review media" },
      };
    }
    case "media_derivative_failed": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const error = typeof metadata.error === "string" ? metadata.error : undefined;
      const assetId = typeof metadata.assetId === "string" ? metadata.assetId : undefined;
      return {
        containerClass: LEVEL_STYLES.error,
        Icon: AlertTriangle,
        iconClass: "bg-rose-100 text-rose-700",
        badge: "Media derivatives failed",
        message: item.message,
        details: error,
        action: { href: assetId ? `/library?asset=${assetId}` : "/library", label: "Retry processing" },
      };
    }
    case "connection_reconnected":
      return {
        containerClass: "border-emerald-200 bg-emerald-50/60",
        Icon: CheckCircle2,
        iconClass: "bg-emerald-100 text-emerald-700",
        badge: "Connection restored",
        message: item.message,
        action: { href: "/connections", label: "View connection" },
      };
    case "connection_metadata_updated": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const provider = typeof metadata.provider === "string" ? metadata.provider : undefined;
      const providerLabel = provider ? PROVIDER_LABELS[provider] ?? provider : "Connection";
      const value = typeof metadata.value === "string" && metadata.value.length ? metadata.value : null;
      const key = typeof metadata.metadataKey === "string" ? metadata.metadataKey : null;
      const detailParts: string[] = [];
      if (key) detailParts.push(`Key: ${key}`);
      if (value) detailParts.push(`Value: ${value}`);

      return {
        containerClass: "border-emerald-300 bg-emerald-50/60",
        Icon: KeyRound,
        iconClass: "bg-emerald-100 text-emerald-700",
        badge: providerLabel,
        message: item.message,
        details: detailParts.join(" · ") || undefined,
        action: { href: "/connections", label: "Review connection" },
      };
    }
    case "connection_needs_action": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const provider = typeof metadata.provider === "string" ? metadata.provider : undefined;
      const providerLabel = provider ? PROVIDER_LABELS[provider] ?? provider : "Connection";
      const reason = typeof metadata.reason === "string" ? metadata.reason : undefined;
      return {
        containerClass: LEVEL_STYLES.error,
        Icon: AlertTriangle,
        iconClass: "bg-rose-100 text-rose-700",
        badge: `${providerLabel} needs attention`,
        message: item.message,
        details: reason,
        action: { href: "/connections", label: "Reconnect" },
      };
    }
    case "weekly_materialised": {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const scheduledCount = Array.isArray(metadata.scheduledContentIds) ? metadata.scheduledContentIds.length : undefined;
      const draftCount = Array.isArray(metadata.draftContentIds) ? metadata.draftContentIds.length : undefined;
      const detailParts: string[] = [];
      if (typeof metadata.campaignId === "string") {
        detailParts.push(`Campaign: ${metadata.campaignId}`);
      }
      if (typeof scheduledCount === "number" && scheduledCount > 0) {
        detailParts.push(`${scheduledCount} scheduled`);
      }
      if (typeof draftCount === "number" && draftCount > 0) {
        detailParts.push(`${draftCount} drafts`);
      }

      return {
        containerClass: LEVEL_STYLES.info,
        Icon: Info,
        iconClass: "bg-brand-mist/30 text-brand-teal",
        badge: "Weekly cadence",
        message: item.message,
        details: detailParts.join(" · ") || undefined,
        action: { href: "/planner", label: "View schedule" },
      };
    }
    default:
      return defaultPresenter;
  }
}

function buildContentAction(metadata: Record<string, unknown> | null | undefined, label: string) {
  const contentId = typeof metadata?.contentId === "string" ? metadata.contentId : null;
  return {
    href: contentId ? `/planner/${contentId}` : "/planner",
    label,
  } as const;
}

export function ActivityCard({
  item,
  onDismiss,
}: {
  item: PlannerActivityItem;
  onDismiss?: (notificationId: string) => void;
}) {
  const presenter = resolvePresenter(item);
  const Icon = presenter.Icon;

  return (
    <article className={`rounded-2xl border bg-white/95 p-4 shadow-sm ${presenter.containerClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full ${presenter.iconClass}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold text-brand-teal">{presenter.badge}</p>
            <p className="text-brand-teal/90">{presenter.message}</p>
            {presenter.details ? <p className="text-xs text-brand-teal/70">{presenter.details}</p> : null}
            <p className="text-xs text-brand-teal/60">{new Date(item.timestamp).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-end">
          {presenter.action ? (
            <Link
              href={presenter.action.href}
              className="rounded-full border border-brand-mist/60 px-3 py-1 text-xs font-semibold text-brand-teal transition hover:border-brand-teal hover:text-brand-caramel"
            >
              {presenter.action.label}
            </Link>
          ) : null}
          {!item.readAt ? <DismissNotificationButton notificationId={item.id} onDismiss={onDismiss} /> : null}
        </div>
      </div>
    </article>
  );
}
