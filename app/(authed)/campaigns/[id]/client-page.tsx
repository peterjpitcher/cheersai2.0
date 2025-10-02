"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import { toLocalYMD } from "@/lib/utils/time";
import Container from "@/components/layout/container";
import {
  Calendar,
  ChevronLeft,
  PartyPopper,
  Sparkles,
  Sun,
  Megaphone,
  Image as ImageIcon,
  Check,
  X,
  RefreshCw,
  Copy,
  Loader2,
  Edit2,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import CampaignActions from "./campaign-actions";
import PostActions from "./post-actions";
import ContentFeedback from "@/components/feedback/content-feedback";
import { PublishAllButton } from "./publish-all-button";
import PlatformBadge from "@/components/ui/platform-badge";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import type { DatabaseWithoutInternals } from "@/lib/database.types";

const CAMPAIGN_ICONS = {
  event: PartyPopper,
  special: Sparkles,
  seasonal: Sun,
  announcement: Megaphone,
};

const PLATFORM_ORDER = ["facebook", "instagram_business", "google_my_business"] as const;
const UNSCHEDULED_KEY = "__unscheduled__";

type CampaignPostRow =
  DatabaseWithoutInternals["public"]["Tables"]["campaign_posts"]["Row"];

export type CampaignPost = Omit<CampaignPostRow, "approved_by"> & {
  approved_by: CampaignPostRow["approved_by"] | { full_name?: string | null } | null;
  approved_by_user?: { full_name?: string | null } | null;
};

interface CampaignHeroImage {
  file_url?: string | null;
}

type CampaignRow =
  DatabaseWithoutInternals["public"]["Tables"]["campaigns"]["Row"];

export interface Campaign extends CampaignRow {
  hero_image?: CampaignHeroImage | null;
  campaign_posts?: CampaignPost[];
}

interface CampaignClientPageProps {
  campaign: Campaign;
}

const normalisePlatform = (value?: string | null) => {
  if (!value) return null;
  return value === "instagram" ? "instagram_business" : value;
};

type PostWithApprover = CampaignPostRow & {
  approved_by_user?: { full_name?: string | null } | null;
  approved_by?: CampaignPostRow["approved_by"] | { full_name?: string | null } | null;
};

const toCampaignPost = (post: PostWithApprover | CampaignPost): CampaignPost => ({
  ...(post as CampaignPost),
  platform: normalisePlatform(post.platform) ?? null,
});

const getTimingLabel = (campaign: Campaign, timing: string, scheduledDate: Date | null) => {
  const timingInfo = POST_TIMINGS.find((t) => t.id === timing);
  if (timingInfo) return timingInfo.label;

  if (!campaign.event_date || !scheduledDate) {
    return "Scheduled Post";
  }

  const eventDate = new Date(campaign.event_date);
  const diffDays = Math.round(
    (scheduledDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return "Day Of Event";
  if (diffDays === 1) return "1 Day After";
  if (diffDays === -1) return "1 Day Before";
  if (diffDays > 0) return `${diffDays} Days After`;
  return `${Math.abs(diffDays)} Days Before`;
};

const sortPlatforms = (platforms: string[]): string[] => {
  return platforms.sort((a, b) => {
    const aIndex = PLATFORM_ORDER.indexOf(a as (typeof PLATFORM_ORDER)[number]);
    const bIndex = PLATFORM_ORDER.indexOf(b as (typeof PLATFORM_ORDER)[number]);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
};

export default function CampaignClientPage({ campaign }: CampaignClientPageProps) {
  const [posts, setPosts] = useState<CampaignPost[]>(
    () => (campaign.campaign_posts || []).map((post) => toCampaignPost(post)) as CampaignPost[],
  );
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedPostForImage, setSelectedPostForImage] = useState<CampaignPost | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [approvingPost, setApprovingPost] = useState<string | null>(null);

  const timeValueFromIso = (iso: string | null) => {
    if (!iso) return "12:00";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "12:00";
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "12:00";
    }
  };

  const setIsoTime = (iso: string | null, hhmm: string) => {
    try {
      const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10));
      const base = iso ? new Date(iso) : new Date();
      if (Number.isNaN(base.getTime())) {
        const now = new Date();
        now.setHours(Number.isNaN(hh) ? 12 : hh, Number.isNaN(mm) ? 0 : mm, 0, 0);
        return now.toISOString();
      }
      base.setHours(Number.isNaN(hh) ? 12 : hh, Number.isNaN(mm) ? 0 : mm, 0, 0);
      return base.toISOString();
    } catch {
      return iso ?? new Date().toISOString();
    }
  };

  const pendingApprovalCount = useMemo(
    () => posts.filter((p) => p.approval_status === "pending").length,
    [posts],
  );
  const approvedCount = useMemo(
    () => posts.filter((p) => p.approval_status === "approved").length,
    [posts],
  );
  const rejectedCount = useMemo(
    () => posts.filter((p) => p.approval_status === "rejected").length,
    [posts],
  );
  const approvedDraftCount = useMemo(
    () => posts.filter((p) => p.status === "draft" && p.approval_status === "approved").length,
    [posts],
  );

  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      const aTime = a.scheduled_for ? new Date(a.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduled_for ? new Date(b.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return (a.post_timing || "").localeCompare(b.post_timing || "");
    });
  }, [posts]);

  const campaignPlatforms = useMemo(() => {
    const set = new Set<string>();
    posts.forEach((post) => {
      const platform = normalisePlatform(post.platform);
      if (platform) set.add(platform);
    });
    return sortPlatforms(Array.from(set));
  }, [posts]);

  const groupedByDate = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: Date | null;
        postsByPlatform: Map<string, CampaignPost[]>;
      }
    >();

    posts.forEach((post) => {
      const platform = normalisePlatform(post.platform);
      if (!platform) return;
      const key = post.scheduled_for ? toLocalYMD(post.scheduled_for) : UNSCHEDULED_KEY;
      if (!groups.has(key)) {
        groups.set(key, {
          date: post.scheduled_for ? new Date(post.scheduled_for) : null,
          postsByPlatform: new Map(),
        });
      }
      const group = groups.get(key)!;
      if (post.scheduled_for) {
        const candidate = new Date(post.scheduled_for);
        if (!group.date || candidate.getTime() < group.date.getTime()) {
          group.date = candidate;
        }
      }
      const existing = group.postsByPlatform.get(platform) ?? [];
      existing.push(post);
      group.postsByPlatform.set(platform, existing);
    });

    groups.forEach((group) => {
      group.postsByPlatform.forEach((list, platform) => {
        list.sort((a, b) => {
          const aTime = a.scheduled_for ? new Date(a.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
          const bTime = b.scheduled_for ? new Date(b.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
          if (aTime !== bTime) return aTime - bTime;
          return (a.post_timing || "").localeCompare(b.post_timing || "");
        });
        group.postsByPlatform.set(platform, list);
      });
    });

    const ordered = Array.from(groups.entries()).map(([key, value]) => ({
      key,
      date: value.date,
      postsByPlatform: value.postsByPlatform,
    }));

    ordered.sort((a, b) => {
      if (a.key === UNSCHEDULED_KEY && b.key === UNSCHEDULED_KEY) return 0;
      if (a.key === UNSCHEDULED_KEY) return 1;
      if (b.key === UNSCHEDULED_KEY) return -1;
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return a.key.localeCompare(b.key);
    });

    return ordered;
  }, [posts]);

  const Icon = CAMPAIGN_ICONS[campaign.campaign_type as keyof typeof CAMPAIGN_ICONS] || Calendar;
  const eventDate = campaign.event_date ? new Date(campaign.event_date) : null;
  const isUpcoming = eventDate ? eventDate > new Date() : false;
  const daysUntil = eventDate
    ? Math.ceil((eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const statusLabel = campaign.status ?? "draft";

  const refreshPostsFromServer = async () => {
    const supabase = createClient();
    const { data: updatedPosts } = await supabase
      .from("campaign_posts")
      .select(
        `
          *,
          approved_by_user:users!campaign_posts_approved_by_fkey (
            full_name
          )
        `,
      )
      .eq("campaign_id", campaign.id)
      .order("scheduled_for");

    if (updatedPosts) {
      setPosts(updatedPosts.map((post) => toCampaignPost(post as PostWithApprover)));
    }
  };

  const handleImageSelect = async (imageUrl: string | null, assetId: string | null) => {
    if (!selectedPostForImage) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("campaign_posts")
      .update({
        media_url: imageUrl,
        media_assets: assetId ? [assetId] : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedPostForImage.id);

    if (!error) {
      setPosts((prev) =>
        prev.map((post) =>
          post.id === selectedPostForImage.id
            ? { ...post, media_url: imageUrl, media_assets: assetId ? [assetId] : null }
            : post,
        ),
      );
    }

    setImageModalOpen(false);
    setSelectedPostForImage(null);
  };

  const saveEditedContent = async (postId: string, newContent: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("campaign_posts")
      .update({
        content: newContent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    if (!error) {
      try {
        await fetch("/api/audit/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType: "campaign_post",
            entityId: postId,
            action: "edit",
            meta: { fields: ["content"] },
          }),
        });
      } catch {}

      setPosts((prev) => prev.map((post) => (post.id === postId ? { ...post, content: newContent } : post)));
      setEditingPost(null);
      setEditedContent({});
    }
  };

  const handleApprovalAction = async (postId: string, action: "approved" | "rejected") => {
    setApprovingPost(postId);
    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("campaign_posts")
        .update({
          approval_status: action,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);

      if (!error) {
        try {
          await fetch("/api/audit/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entityType: "campaign_post", entityId: postId, action, meta: {} }),
          });
        } catch {}

        const { data: userData } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", user.id)
          .single();

        setPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  approval_status: action,
                  approved_by: user.id,
                  approved_at: new Date().toISOString(),
                  approved_by_user: { full_name: userData?.full_name || "Unknown" },
                }
              : post,
          ),
        );
      }
    } catch (error) {
      console.error("Approval action failed:", error);
    } finally {
      setApprovingPost(null);
    }
  };

  const regeneratePost = async (postTiming: string, platform?: string | null) => {
    const key = `${postTiming}-${platform || ""}`;
    setRegenerating(key);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.id,
          postTiming,
          campaignType: campaign.campaign_type,
          campaignName: campaign.name,
          eventDate: campaign.event_date,
          platform: platform || "facebook",
        }),
      });

      if (response.ok) {
        const json = await response.json();
        const content: string = json?.data?.content ?? json?.content ?? "";
        setPosts((prev) =>
          prev.map((post) =>
            post.post_timing === postTiming && post.platform === platform
              ? { ...post, content }
              : post,
          ),
        );
      }
    } catch (error) {
      console.error("Regeneration failed:", error);
    }

    setRegenerating(null);
  };

  const copyToClipboard = async (content: string, key: string) => {
    await navigator.clipboard.writeText(content || "");
    setCopiedPost(key);
    setTimeout(() => setCopiedPost(null), 2000);
  };

  const getApprovalStatusBadge = (post: CampaignPost) => {
    const status = post.approval_status || "pending";
    const approvedByName =
      post.approved_by_user?.full_name ||
      (typeof post.approved_by === "object" ? post.approved_by?.full_name : undefined);

    switch (status) {
      case "approved":
        return (
          <Badge variant="default" className="border-green-200 bg-green-100 text-green-800" size="sm">
            <CheckCircle className="mr-1 size-3" />
            Approved
            {approvedByName && <span className="ml-1 text-xs">by {approvedByName}</span>}
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="border-red-200 bg-red-100 text-red-800" size="sm">
            <XCircle className="mr-1 size-3" />
            Rejected
            {approvedByName && <span className="ml-1 text-xs">by {approvedByName}</span>}
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="border-yellow-200 bg-yellow-100 text-yellow-800" size="sm">
            <Clock className="mr-1 size-3" />
            Pending
          </Badge>
        );
    }
  };

  const renderPostCard = (post: CampaignPost, platform: string) => {
    const isEditing = editingPost === post.id;
    const editBuffer = editedContent[post.id] ?? post.content;
    const regenKey = `${post.post_timing}-${post.platform || ""}`;
    const scheduledDate = post.scheduled_for ? new Date(post.scheduled_for) : null;
    const timingLabel = getTimingLabel(campaign, post.post_timing || "", scheduledDate);
    const imageUrl = post.media_url ?? campaign.hero_image?.file_url ?? undefined;
    const approvalStatus = post.approval_status || "pending";
    const approvalBusy = approvingPost === post.id;

    return (
      <div key={post.id} className="space-y-4 rounded-card border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformBadge platform={platform} size="sm" />
            {getApprovalStatusBadge(post)}
            {post.media_url && (
              <Badge variant="secondary" size="sm">
                <ImageIcon className="mr-1 size-3" />
                Custom Image
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <label className="text-xs text-text-secondary" htmlFor={`time-${post.id}`}>
                Time
              </label>
              <input
                id={`time-${post.id}`}
                type="time"
                className="h-8 rounded-md border border-input px-2 py-1 text-xs"
                value={timeValueFromIso(post.scheduled_for)}
                onChange={async (e) => {
                  const newIso = setIsoTime(post.scheduled_for, e.target.value);
                  setPosts((prev) =>
                    prev.map((p) => (p.id === post.id ? { ...p, scheduled_for: newIso } : p)),
                  );
                  try {
                    await fetch("/api/queue/sync", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ postId: post.id, scheduledFor: newIso }),
                    });
                  } catch {}
                }}
                step={60}
              />
            </div>
            <button
              onClick={() => handleApprovalAction(post.id, "approved")}
              disabled={approvalBusy}
              className={`flex size-10 items-center justify-center rounded-full border transition-colors ${
                approvalStatus === "approved"
                  ? "border-success bg-success text-white"
                  : "border-success/40 bg-white text-success hover:bg-success/10"
              } ${approvalBusy ? "opacity-60" : ""}`}
              title="Mark as approved"
            >
              {approvalBusy && approvalStatus !== "approved" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Check className="size-5" />
              )}
            </button>
            <button
              onClick={() => handleApprovalAction(post.id, "rejected")}
              disabled={approvalBusy}
              className={`flex size-10 items-center justify-center rounded-full border transition-colors ${
                approvalStatus === "rejected"
                  ? "border-destructive bg-destructive text-white"
                  : "border-destructive/40 bg-white text-destructive hover:bg-destructive/10"
              } ${approvalBusy ? "opacity-60" : ""}`}
              title="Mark as rejected"
            >
              {approvalBusy && approvalStatus !== "rejected" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <X className="size-5" />
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between text-xs text-text-secondary">
          <span>{timingLabel}</span>
          {scheduledDate && (
            <span>
              {formatDate(scheduledDate, undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
              {scheduledDate.getHours() !== 0 && ` · ${formatTime(scheduledDate)}`}
            </span>
          )}
        </div>

        <div>
          <div className="mb-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-card border border-border bg-gray-100">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt="Campaign creative"
                  fill
                  sizes="(min-width: 768px) 320px, 100vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-text-secondary">
                  <ImageIcon className="size-6" />
                </div>
              )}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => {
                  setSelectedPostForImage(post);
                  setImageModalOpen(true);
                }}
                className="rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-muted"
              >
                Replace Image
              </button>
            </div>
          </div>

          {isEditing ? (
            <textarea
              value={editBuffer}
              onChange={(e) => setEditedContent((prev) => ({ ...prev, [post.id]: e.target.value }))}
              className="min-h-[140px] w-full rounded-md border border-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          ) : (
            <div className="whitespace-pre-wrap rounded-soft bg-background p-3 text-sm text-text-primary">
              {post.content}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-text-secondary">
            {editBuffer.length} characters
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => saveEditedContent(post.id, editBuffer)}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingPost(null);
                    setEditedContent((prev) => {
                      const next = { ...prev };
                      delete next[post.id];
                      return next;
                    });
                  }}
                  className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-muted/80"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setEditingPost(post.id);
                    setEditedContent((prev) => ({ ...prev, [post.id]: post.content }));
                  }}
                  className="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-muted hover:text-primary"
                  title="Edit"
                >
                  <Edit2 className="size-4" />
                </button>
                <button
                  onClick={() => regeneratePost(post.post_timing, post.platform)}
                  disabled={regenerating === regenKey}
                  className="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-muted hover:text-primary disabled:opacity-60"
                  title="Regenerate"
                >
                  {regenerating === regenKey ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </button>
                <button
                  onClick={() => copyToClipboard(post.content, regenKey)}
                  className="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-muted hover:text-primary"
                  title="Copy"
                >
                  {copiedPost === regenKey ? (
                    <Check className="size-4 text-success" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
                <PostActions
                  post={{
                    id: post.id,
                    content: post.content,
                    scheduled_for: post.scheduled_for,
                    approval_status: post.approval_status,
                    platform: post.platform,
                    platforms: post.platforms ?? null,
                  }}
                  campaignName={campaign.name}
                  imageUrl={imageUrl}
                  compact
                />
              </>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-gray-50/30 p-3">
          <ContentFeedback
            content={post.content}
            platform={platform}
            generationType="campaign"
            campaignId={campaign.id}
            postId={post.id}
            onRegenerate={() => regeneratePost(post.post_timing, post.platform)}
            className="border-0 bg-transparent"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="py-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/campaigns" className="text-text-secondary transition-colors hover:text-primary">
                <ChevronLeft className="size-6" />
              </Link>
              <div>
                <h1 className="font-heading text-2xl font-bold">{campaign.name}</h1>
                <p className="flex items-center gap-2 text-sm text-text-secondary">
                  <Icon className="size-4" />
                  {campaign.campaign_type.charAt(0).toUpperCase() + campaign.campaign_type.slice(1)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PublishAllButton
                campaignId={campaign.id}
                approvedDraftCount={approvedDraftCount}
                onSuccess={refreshPostsFromServer}
              />
              <CampaignActions campaignId={campaign.id} campaignName={campaign.name} posts={sortedPosts} />
            </div>
          </div>
        </Container>

        <Container className="py-2">
          <div className="mb-6 rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-4 lg:gap-6">
              <div className="flex items-center gap-2">
                <Calendar className="size-5 text-primary" />
                <div>
                  {eventDate ? (
                    <>
                      <p className="text-sm font-medium">
                        {formatDate(eventDate, undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                      {eventDate.getHours() !== 0 && (
                        <p className="text-xs text-text-secondary">{formatTime(eventDate)}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-text-secondary">No event date set</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={`size-3 rounded-full ${statusLabel === "active" ? "bg-success" : "bg-warning"}`} />
                <span className="text-sm font-medium capitalize">{statusLabel}</span>
              </div>

              <div className="text-sm">
                <span className="font-medium">{sortedPosts.length}</span>
                <span className="text-text-secondary"> posts</span>
              </div>

              {pendingApprovalCount > 0 && (
                <div className="text-sm">
                  <span className="font-medium text-yellow-600">{pendingApprovalCount}</span>
                  <span className="text-text-secondary"> pending approval</span>
                </div>
              )}
              {approvedCount > 0 && (
                <div className="text-sm">
                  <span className="font-medium text-green-600">{approvedCount}</span>
                  <span className="text-text-secondary"> approved</span>
                </div>
              )}
              {rejectedCount > 0 && (
                <div className="text-sm">
                  <span className="font-medium text-red-600">{rejectedCount}</span>
                  <span className="text-text-secondary"> rejected</span>
                </div>
              )}

              {campaignPlatforms.length > 0 && (
                <div className="text-sm">
                  <span className="font-medium">{campaignPlatforms.length}</span>
                  <span className="text-text-secondary"> platforms</span>
                </div>
              )}

              {isUpcoming && (
                <div className="text-sm">
                  <span className="font-medium text-primary">{daysUntil}</span>
                  <span className="text-text-secondary"> days until event</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold">Campaign Posts</h2>
              {campaignPlatforms.length > 0 && groupedByDate.length > 0 && (
                <div className="text-sm text-text-secondary">
                  {groupedByDate.length} dates × {campaignPlatforms.length} platforms
                </div>
              )}
            </div>

            {sortedPosts.length === 0 ? (
              <EmptyState
                title="No posts generated yet"
                body="Generate content for your campaign to see posts here."
                primaryCta={{ label: "Generate Posts", href: `/campaigns/${campaign.id}/generate` }}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
                <table className="w-full table-fixed">
                  <thead className="border-b border-border bg-gray-50">
                    <tr>
                      <th className="w-48 p-4 text-left font-medium text-text-primary">Date</th>
                      {campaignPlatforms.map((platform) => (
                        <th key={platform} className="min-w-[320px] p-4 text-left font-medium">
                          <PlatformBadge platform={platform} size="md" />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedByDate.map((group, index) => {
                      const { key, date, postsByPlatform } = group;
                      const isUnscheduled = key === UNSCHEDULED_KEY;

                      return (
                        <tr key={key} className={index % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                          <td className="border-r border-border p-4 align-top">
                            <div className="space-y-1">
                              <div className="font-medium">
                                {isUnscheduled || !date
                                  ? "Unscheduled posts"
                                  : formatDate(date, undefined, {
                                      weekday: "long",
                                      day: "numeric",
                                      month: "long",
                                    })}
                              </div>
                              {!isUnscheduled && date && (
                                <div className="text-sm text-text-secondary">
                                  {formatDate(date, undefined, {
                                    weekday: "short",
                                    day: "numeric",
                                    month: "short",
                                  })}
                                </div>
                              )}
                              <div className="text-xs text-text-secondary/80">{postsByPlatform.size} platform(s)</div>
                            </div>
                          </td>
                          {campaignPlatforms.map((platform) => {
                            const postsForPlatform = postsByPlatform.get(platform) ?? [];
                            return (
                              <td key={`${key}-${platform}`} className="p-4 align-top">
                                {postsForPlatform.length === 0 ? (
                                  <div className="rounded-card border border-dashed border-border bg-background/50 p-6 text-center text-sm text-text-secondary">
                                    No content
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    {postsForPlatform.map((post) => renderPostCard(post, platform))}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Container>
      </main>

      {selectedPostForImage && (
        <ImageSelectionModal
          isOpen={imageModalOpen}
          onClose={() => {
            setImageModalOpen(false);
            setSelectedPostForImage(null);
          }}
          onSelect={(imageUrl, assetId) => void handleImageSelect(imageUrl, assetId)}
          currentImageUrl={selectedPostForImage.media_url ?? null}
          defaultImageUrl={campaign.hero_image?.file_url}
          postId={selectedPostForImage.id}
          platform={selectedPostForImage.platform ?? undefined}
        />
      )}
    </div>
  );
}
