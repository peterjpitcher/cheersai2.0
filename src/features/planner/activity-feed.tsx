"use client";

import { useCallback } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, KeyRound } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { DismissNotificationButton } from "@/features/planner/dismiss-notification-button";
import { useRealtimeFeed } from "@/hooks/use-realtime-feed";
import type { FeedEvent, FeedEventType } from "@/types/notifications";

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

// ---------------------------------------------------------------------------
// Mapping helpers: PlannerActivityItem <-> FeedEvent
// ---------------------------------------------------------------------------

const ERROR_TYPES: FeedEventType[] = ["publish_failure", "token_expiry", "media_derivative_failed"];
const WARNING_TYPES: FeedEventType[] = ["publish_retry", "connection_change", "media_derivative_skipped"];

function feedEventTypeToLevel(type: FeedEventType): "info" | "warning" | "error" {
  if (ERROR_TYPES.includes(type)) return "error";
  if (WARNING_TYPES.includes(type)) return "warning";
  return "info";
}

function mapFeedEventToActivityItem(event: FeedEvent): PlannerActivityItem {
  return {
    id: event.id,
    message: event.message,
    timestamp: event.timestamp,
    level: feedEventTypeToLevel(event.type),
    category: event.category,
    metadata: event.metadata,
    readAt: event.readAt,
  };
}

function mapToFeedEvents(items: PlannerActivityItem[]): FeedEvent[] {
  return items.map((item) => ({
    id: item.id,
    type: (item.category as FeedEventType) ?? "connection_change",
    platform: null,
    message: item.message,
    timestamp: item.timestamp,
    category: item.category ?? null,
    metadata: item.metadata ?? null,
    resourceId: null,
    readAt: item.readAt ?? null,
  }));
}

// ---------------------------------------------------------------------------
// PlannerActivityFeed — Realtime-powered (no polling)
// ---------------------------------------------------------------------------

interface PlannerActivityFeedProps {
  accountId: string;
  initialEvents: PlannerActivityItem[];
}

export function PlannerActivityFeed({ accountId, initialEvents }: PlannerActivityFeedProps) {
  const events = useRealtimeFeed(accountId, mapToFeedEvents(initialEvents));
  const activityItems = events.map(mapFeedEventToActivityItem);

  const handleDismiss = useCallback((notificationId: string) => {
    // Dismissal is handled server-side; the item will disappear on next Realtime update
    // or page navigation. No local state mutation needed since events come from the hook.
    void notificationId;
  }, []);

  let content: React.ReactNode;

  if (!activityItems.length) {
    content = (
      <article className="rounded-2xl border border-brand-mist/60 bg-white/95 px-4 py-5 text-sm text-brand-teal">
        <p className="font-semibold text-brand-teal">You&apos;re all caught up.</p>
        <p className="mt-1 text-brand-teal/70">We&apos;ll surface new publishing updates here as they arrive.</p>
      </article>
    );
  } else {
    content = activityItems.map((item) => <ActivityCard key={item.id} item={item} onDismiss={handleDismiss} />);
  }

  return (
    <div className="space-y-3">
      {content}
      <div className="flex items-center justify-end">
        <Link
          href="/planner/notifications"
          className="ml-auto text-right text-xs font-semibold text-brand-teal/70 underline-offset-4 transition hover:text-brand-teal"
        >
          View full history
        </Link>
      </div>
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
