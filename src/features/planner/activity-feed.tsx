"use client";

import { useCallback } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, KeyRound } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { DismissNotificationButton } from "@/features/planner/dismiss-notification-button";
import { useRealtimeFeed } from "@/hooks/use-realtime-feed";
import type { FeedEvent, FeedEventType } from "@/types/notifications";

/* Tone styles use inline CSS vars set on the article element */
const LEVEL_TONE = {
  info: { border: "var(--c-line)", bg: "var(--c-paper)", fg: "var(--c-ink-3)" },
  warning: { border: "var(--c-orange-soft)", bg: "var(--c-orange-tint)", fg: "var(--c-orange)" },
  error: { border: "var(--c-claret-soft)", bg: "color-mix(in srgb, var(--c-claret-soft) 40%, var(--c-card))", fg: "var(--c-claret)" },
} as const;

const PROVIDER_LABELS: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram Business",
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

type ToneStyle = { border: string; bg: string; fg: string };

type Presenter = {
  tone: ToneStyle;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconBg: string;
  iconFg: string;
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
      <article
        className="rounded-2xl border px-4 py-5 text-sm"
        style={{
          borderColor: "var(--c-line)",
          backgroundColor: "var(--c-card)",
          color: "var(--c-ink)",
        }}
      >
        <p className="font-semibold" style={{ color: "var(--c-ink)" }}>You&apos;re all caught up.</p>
        <p className="mt-1" style={{ color: "var(--c-ink-3)" }}>We&apos;ll surface new publishing updates here as they arrive.</p>
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
          className="ml-auto text-right text-xs font-semibold underline-offset-4 transition"
          style={{ color: "var(--c-ink-3)" }}
        >
          View full history
        </Link>
      </div>
    </div>
  );
}

/* Shared tone definitions for reuse across categories */
const SUCCESS_TONE: ToneStyle = { border: "var(--c-status-posted-bg)", bg: "var(--c-status-posted-bg)", fg: "var(--c-status-posted-fg)" };
const WARNING_TONE: ToneStyle = LEVEL_TONE.warning;
const ERROR_TONE: ToneStyle = LEVEL_TONE.error;
const INFO_TONE: ToneStyle = LEVEL_TONE.info;

export function resolvePresenter(item: PlannerActivityItem): Presenter {
  const defaultPresenter: Presenter = {
    tone: LEVEL_TONE[item.level],
    Icon: item.level === "error" ? AlertTriangle : item.level === "warning" ? AlertTriangle : Info,
    iconBg:
      item.level === "error"
        ? "var(--c-claret)"
        : item.level === "warning"
          ? "var(--c-orange)"
          : "var(--c-ink-3)",
    iconFg: "#FFFFFF",
    badge: item.level === "error" ? "Action required" : item.level === "warning" ? "Heads up" : "Activity",
    message: item.message,
  };

  if (!item.category) {
    return defaultPresenter;
  }

  switch (item.category) {
    case "publish_success":
      return {
        tone: SUCCESS_TONE,
        Icon: CheckCircle2,
        iconBg: "var(--c-status-posted-fg)",
        iconFg: "#FFFFFF",
        badge: "Publish success",
        message: item.message,
        action: buildContentAction(item.metadata, "View post"),
      };
    case "story_publish_succeeded":
      return {
        tone: SUCCESS_TONE,
        Icon: CheckCircle2,
        iconBg: "var(--c-status-posted-fg)",
        iconFg: "#FFFFFF",
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
        tone: WARNING_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-orange)",
        iconFg: "#FFFFFF",
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
        tone: WARNING_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-orange)",
        iconFg: "#FFFFFF",
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
        tone: ERROR_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-claret)",
        iconFg: "#FFFFFF",
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
        tone: ERROR_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-claret)",
        iconFg: "#FFFFFF",
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
        tone: WARNING_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-orange)",
        iconFg: "#FFFFFF",
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
        tone: ERROR_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-claret)",
        iconFg: "#FFFFFF",
        badge: "Media derivatives failed",
        message: item.message,
        details: error,
        action: { href: assetId ? `/library?asset=${assetId}` : "/library", label: "Retry processing" },
      };
    }
    case "connection_reconnected":
      return {
        tone: SUCCESS_TONE,
        Icon: CheckCircle2,
        iconBg: "var(--c-status-posted-fg)",
        iconFg: "#FFFFFF",
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
        tone: SUCCESS_TONE,
        Icon: KeyRound,
        iconBg: "var(--c-status-posted-fg)",
        iconFg: "#FFFFFF",
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
        tone: ERROR_TONE,
        Icon: AlertTriangle,
        iconBg: "var(--c-claret)",
        iconFg: "#FFFFFF",
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
        tone: INFO_TONE,
        Icon: Info,
        iconBg: "var(--c-ink-3)",
        iconFg: "#FFFFFF",
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
  const isUnread = !item.readAt;

  return (
    <article
      className="rounded-[var(--r-xl)] border p-4"
      style={{
        borderColor: presenter.tone.border,
        backgroundColor: presenter.tone.bg,
        borderLeft: isUnread ? `3px solid ${presenter.tone.fg}` : undefined,
        opacity: isUnread ? 1 : 0.8,
        boxShadow: "var(--sh-xs)",
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: presenter.iconBg, color: presenter.iconFg }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="text-[14px] font-medium" style={{ color: "var(--c-ink)" }}>{presenter.badge}</p>
            <p className="text-[13px]" style={{ color: "var(--c-ink-2)" }}>{presenter.message}</p>
            {presenter.details ? <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>{presenter.details}</p> : null}
            <p className="mono text-xs" style={{ color: "var(--c-ink-3)" }}>{new Date(item.timestamp).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-col sm:items-end">
          {presenter.action ? (
            <Link
              href={presenter.action.href}
              className="rounded-[var(--r-md)] border px-3 py-1 text-xs font-semibold transition"
              style={{
                borderColor: "var(--c-line)",
                color: "var(--c-ink-2)",
                backgroundColor: "transparent",
              }}
            >
              {presenter.action.label}
            </Link>
          ) : null}
          {isUnread ? <DismissNotificationButton notificationId={item.id} onDismiss={onDismiss} /> : null}
        </div>
      </div>
    </article>
  );
}
