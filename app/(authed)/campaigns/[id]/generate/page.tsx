"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles,
  Clock,
  Calendar,
  Edit2,
  RefreshCw,
  Copy,
  Check,
  Facebook,
  Instagram,
  MapPin,
  X,
  AlertCircle,
  Link2,
  Image as ImageIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Container from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
import ContentFeedback from "@/components/feedback/content-feedback";
import { formatDate } from "@/lib/datetime";
import { toLocalYMD } from "@/lib/utils/time";

type ApprovalStatus = "pending" | "approved" | "rejected" | "draft";
type SocialPlatform =
  | "facebook"
  | "instagram"
  | "instagram_business"
  | "google_my_business"
  | string;

interface Campaign {
  id: string;
  name: string;
  campaign_type: string;
  event_date: string;
  hero_image?: {
    file_url: string | null;
  } | null;
  selected_timings?: string[] | null;
  custom_dates?: string[] | null;
}

interface CampaignPost {
  id?: string;
  post_timing: string;
  content: string;
  scheduled_for: string;
  platform?: SocialPlatform | null;
  status?: string | null;
  approval_status?: ApprovalStatus | null;
  media_url?: string | null;
  media_assets?: string[] | null;
}

type PlatformMeta = {
  icon: LucideIcon;
  label: string;
  color: string;
};

type BatchSummary = {
  created?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  reason?: string;
};

type GenerationProgress = {
  current: number;
  total: number;
  currentPlatform: string;
  currentTiming: string;
};

type CampaignContext = {
  campaign: Campaign;
  platforms?: SocialPlatform[] | null;
  posts?: CampaignPost[] | null;
};

// Platform icons and labels
const platformInfo: Record<string, PlatformMeta> = {
  facebook: { icon: Facebook, label: "Facebook", color: "bg-blue-600" },
  instagram_business: {
    icon: Instagram,
    label: "Instagram",
    color: "bg-gradient-to-br from-purple-600 to-pink-500",
  },
  google_my_business: {
    icon: MapPin,
    label: "Google Business Profile",
    color: "bg-green-600",
  },
};

export default function GenerateCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignId = params.id as string;
  const searchParamsString = searchParams?.toString() ?? "";

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<string | null>(null);
  // Matrix view removed; always timeline
  const [approvalStatus, setApprovalStatus] = useState<
    Record<string, ApprovalStatus>
  >({});
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [generationProgress, setGenerationProgress] =
    useState<GenerationProgress>({
      current: 0,
      total: 0,
      currentPlatform: "",
      currentTiming: "",
    });
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [quickDate, setQuickDate] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );
  const [quickTime, setQuickTime] = useState<string>("18:00");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedPostKeyForImage, setSelectedPostKeyForImage] = useState<
    string | null
  >(null);
  const [campaignLoadError, setCampaignLoadError] = useState<string | null>(
    null,
  );
  const generateStartedRef = useRef(false);

  const normalisePlatform = (value: SocialPlatform): SocialPlatform =>
    value === "instagram" ? "instagram_business" : value;

  // Render plain-text content with real paragraph spacing. We treat two or more
  // consecutive newlines as a paragraph break, and single newlines as line breaks.
  const renderContent = (text: string) => {
    const t = text || "";
    const hasDouble = /\n\s*\n/.test(t);
    const paragraphs = hasDouble ? t.split(/\n\s*\n/) : t.split(/\n+/);
    return (
      <div className="text-sm leading-relaxed">
        {paragraphs.map((para, idx) => (
          <p key={idx} className="mb-3 whitespace-pre-wrap last:mb-0">
            {para}
          </p>
        ))}
      </div>
    );
  };

  // Helpers to view/update times in local timezone
  const timeValueFromIso = (iso: string) => {
    try {
      const d = new Date(iso);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "12:00";
    }
  };
  const setIsoTime = (iso: string, hhmm: string) => {
    try {
      const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10));
      const d = new Date(iso);
      d.setHours(isNaN(hh) ? 12 : hh, isNaN(mm) ? 0 : mm, 0, 0);
      return d.toISOString();
    } catch {
      return iso;
    }
  };

  // Helper to strip simple formatting markers like **bold**, __bold__ and backticks
  const stripFormatting = (text: string) => {
    if (!text) return text;
    let t = text.replace(/\*\*(.*?)\*\*/g, "$1");
    t = t.replace(/__(.*?)__/g, "$1");
    t = t.replace(/`{1,3}([^`]+)`{1,3}/g, "$1");
    return t;
  };

  const fetchCampaign = useCallback(async () => {
    setCampaignLoadError(null);
    try {
      // Ensure tenant cookies and server context are hydrated
      try {
        await fetch("/api/tenant/bootstrap", { method: "GET" });
      } catch {}
      const resp = await fetch(`/api/campaigns/${campaignId}/context`, {
        method: "GET",
      });
      if (!resp.ok) {
        if (resp.status === 401)
          setCampaignLoadError("Not signed in. Please sign in again.");
        else if (resp.status === 404)
          setCampaignLoadError("Campaign not found or you do not have access.");
        else setCampaignLoadError("Failed to load this campaign.");
        setLoadingInitial(false);
        return;
      }
      const json = await resp.json().catch(() => ({}));
      const ctx: CampaignContext =
        (json as { data?: CampaignContext }).data ?? (json as CampaignContext);
      if (ctx?.campaign) {
        setCampaign(ctx.campaign);
      }
      if (Array.isArray(ctx?.platforms)) {
        setPlatforms(ctx.platforms as SocialPlatform[]);
      }
      const existingPosts = Array.isArray(ctx?.posts) ? ctx.posts : [];
      setPosts(existingPosts);
      const status: Record<string, ApprovalStatus> = {};
      existingPosts.forEach((post) => {
        const key = `${post.post_timing}-${post.platform ?? ""}`;
        status[key] = (post.approval_status ?? "pending") as ApprovalStatus;
      });
      setApprovalStatus(status);
    } catch (e) {
      console.error("fetchCampaign error:", e);
      setCampaignLoadError("Failed to load this campaign.");
    }
    setLoadingInitial(false);
  }, [campaignId]);

  useEffect(() => {
    void fetchCampaign();
  }, [fetchCampaign]);

  // Optional auto-start generation via query param (no change to default UX)
  useEffect(() => {
    if (!campaign || generating || loadingInitial) return;
    if (generateStartedRef.current) return;
    if (posts.length > 0) return;
    const params = new URLSearchParams(searchParamsString);
    const auto = params.get("autostart") || params.get("auto");
    if (auto) {
      generateStartedRef.current = true;
      // Fire and forget; UI already tracks progress and completion
      generateAllPosts(campaign);
    }
  }, [
    campaign,
    posts.length,
    generating,
    loadingInitial,
    searchParamsString,
    generateAllPosts,
  ]);

  // Suggestion actions removed; booking link and event-day hours are baked into generated copy

  const generateAllPosts = useCallback(
    async (campaignData: Campaign) => {
      setGenerating(true);
      setBatchSummary(null);
      setGenerationProgress({
        current: 0,
        total: 0,
        currentPlatform: "",
        currentTiming: "",
      });

      // Use platforms derived from server context (avoids client-side auth entirely)
      const connectedPlatforms: SocialPlatform[] = Array.from(
        new Set(platforms.map(normalisePlatform)),
      ) as SocialPlatform[];

      const selectedTimings = campaignData.selected_timings?.length
        ? campaignData.selected_timings
        : ["week_before", "day_before", "day_of"];
      const customDates = campaignData.custom_dates ?? [];

      // Pre-compute work items to drive the on-screen progress tracker
      const workItems: Array<{ platform: SocialPlatform; timing: string }> = [];
      for (const t of selectedTimings) {
        for (const p of connectedPlatforms) {
          workItems.push({ platform: p, timing: t });
        }
      }
      for (let index = 0; index < customDates.length; index += 1) {
        for (const p of connectedPlatforms) {
          workItems.push({ platform: p, timing: "custom" });
        }
      }
      // Initialise progress UI using the computed total
      if (workItems.length > 0) {
        setGenerationProgress({
          current: 0,
          total: workItems.length,
          currentPlatform: workItems[0].platform,
          currentTiming: workItems[0].timing,
        });
      }

      // Progress polling based on actual inserted rows in DB
      // 1) Capture initial count
      let initialCount = 0;
      try {
        const timingsParam = Array.from(
          new Set([
            ...selectedTimings,
            ...(customDates.length > 0 ? ["custom"] : []),
          ]),
        ).join(",");
        const platformsParam = connectedPlatforms.join(",");
        const resp = await fetch(
          `/api/campaigns/${campaignId}/post-count?platforms=${encodeURIComponent(platformsParam)}&timings=${encodeURIComponent(timingsParam)}`,
        );
        const json = await resp.json().catch(() => ({}));
        initialCount = json?.data?.count ?? json?.count ?? 0;
      } catch {}

      // 2) Start polling during batch generation to reflect real progress
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      if (workItems.length > 0) {
        progressTimer = setInterval(async () => {
          try {
            const timingsParam = Array.from(
              new Set([
                ...selectedTimings,
                ...(customDates.length > 0 ? ["custom"] : []),
              ]),
            ).join(",");
            const platformsParam = connectedPlatforms.join(",");
            const resp = await fetch(
              `/api/campaigns/${campaignId}/post-count?platforms=${encodeURIComponent(platformsParam)}&timings=${encodeURIComponent(timingsParam)}`,
            );
            const json = await resp.json().catch(() => ({}));
            const curCt = json?.data?.count ?? json?.count ?? 0;
            const createdNow = Math.max(0, (curCt || 0) - initialCount);
            const clamped = Math.min(createdNow, workItems.length);
            const idx = Math.max(0, Math.min(workItems.length - 1, clamped));
            const cur = workItems[idx] || { platform: "", timing: "" };
            setGenerationProgress({
              current: clamped,
              total: workItems.length,
              currentPlatform: cur.platform,
              currentTiming: cur.timing,
            });
          } catch {}
        }, 800);
      }

      try {
        const params = new URLSearchParams(searchParamsString);
        const debug = params.get("debug") === "1";
        const resp = await fetch(
          `/api/campaigns/${campaignId}/generate-batch${debug ? "?debug=1" : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Omit platforms so the server resolves from social_connections (single source of truth)
            body: JSON.stringify({ selectedTimings, customDates }),
          },
        );
        const json = (await resp
          .json()
          .catch(() => ({}))) as Partial<BatchSummary> & { items?: unknown[] };
        if (resp.ok) {
          const summary: BatchSummary = {
            created:
              typeof json.created === "number" ? json.created : undefined,
            updated:
              typeof json.updated === "number" ? json.updated : undefined,
            skipped:
              typeof json.skipped === "number" ? json.skipped : undefined,
            failed: typeof json.failed === "number" ? json.failed : undefined,
            reason: typeof json.reason === "string" ? json.reason : undefined,
          };
          setBatchSummary(summary);
        } else {
          const failedCount = Array.isArray(json.items)
            ? json.items.length
            : undefined;
          setBatchSummary({
            failed: failedCount && failedCount > 0 ? failedCount : 1,
          });
        }
      } catch {
        setBatchSummary({ failed: 1 });
      }

      // Refresh posts from server context (SSR auth)
      try {
        const ctxResp = await fetch(`/api/campaigns/${campaignId}/context`, {
          method: "GET",
        });
        const ctxJson = await ctxResp.json().catch(() => ({}));
        const data: CampaignContext =
          (ctxJson as { data?: CampaignContext }).data ??
          (ctxJson as CampaignContext);
        if (Array.isArray(data?.posts)) setPosts(data.posts as CampaignPost[]);
      } catch {}

      // Complete and clear progress polling
      if (workItems.length > 0) {
        setGenerationProgress({
          current: workItems.length,
          total: workItems.length,
          currentPlatform: workItems[workItems.length - 1].platform,
          currentTiming: workItems[workItems.length - 1].timing,
        });
      }
      if (progressTimer) clearInterval(progressTimer);
      setGenerating(false);
      // Reset progress shortly after completion
      setTimeout(
        () =>
          setGenerationProgress({
            current: 0,
            total: 0,
            currentPlatform: "",
            currentTiming: "",
          }),
        600,
      );
    },
    [campaignId, platforms, searchParamsString],
  );

  const regeneratePost = async (postTiming: string, platform?: string) => {
    if (!campaign) return;

    setGenerating(true);
    try {
      const params = new URLSearchParams(searchParamsString);
      const debug = params.get("debug") === "1";
      const response = await fetch(`/api/generate${debug ? "?debug=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          postTiming,
          campaignType: campaign.campaign_type,
          campaignName: campaign.name,
          eventDate: campaign.event_date,
          platform: platform || "facebook",
          maxLength: undefined,
        }),
      });

      if (response.ok) {
        const json = await response.json();
        const content: string = json?.data?.content ?? json?.content ?? "";
        const stripped = stripFormatting(content);
        const target = posts.find(
          (p) => p.post_timing === postTiming && p.platform === platform,
        );
        if (target?.id) {
          try {
            const supabase = createClient();
            await supabase
              .from("campaign_posts")
              .update({ content: stripped })
              .eq("id", target.id);
          } catch {}
        }
        setPosts(
          posts.map((p) =>
            p.post_timing === postTiming && p.platform === platform
              ? { ...p, content: stripped }
              : p,
          ),
        );
      }
    } catch (error) {
      console.error("Regeneration failed:", error);
    }
    setGenerating(false);
  };

  const updatePostContent = (
    postTiming: string,
    platform: string,
    content: string,
  ) => {
    setPosts(
      posts.map((p) =>
        p.post_timing === postTiming && p.platform === platform
          ? { ...p, content: stripFormatting(content) }
          : p,
      ),
    );
  };

  const copyToClipboard = async (content: string, key: string) => {
    await navigator.clipboard.writeText(content || "");
    setCopiedPost(key);
    setTimeout(() => setCopiedPost(null), 2000);
  };

  // Unique timings present in current posts (sorted by POST_TIMINGS order, then custom at end)
  // Build chronological groups by the calendar date (YYYY-MM-DD) of scheduled_for
  // Stable day grouping independent of time-of-day edits.
  const localDateKey = (iso: string) => toLocalYMD(iso);
  const uniqueDates = Array.from(
    new Set(posts.map((p) => localDateKey(p.scheduled_for))),
  ).sort();
  const PLATFORM_SORT = [
    "facebook",
    "instagram_business",
    "instagram",
    "google_my_business",
  ];

  if (campaignLoadError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-3 text-center">
          <h2 className="text-lg font-semibold">Unable to load campaign</h2>
          <p className="text-sm text-text-secondary">{campaignLoadError}</p>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={fetchCampaign} variant="default" size="sm">
              Retry
            </Button>
            <Button
              onClick={() => router.push("/campaigns")}
              variant="outline"
              size="sm"
            >
              Back to campaigns
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!campaign || loadingInitial) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="size-4 animate-pulse rounded-full bg-primary"
                  style={{
                    animationDelay: `${i * 0.2}s`,
                    animationDuration: "1s",
                  }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-medium">Loading Campaign</h2>
            <p className="text-sm text-text-secondary">
              Preparing your AI-powered content generation...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // uniqueTimings already computed from posts

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-[9] border-b border-border bg-surface">
        <Container className="py-3">
          {batchSummary && (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span className="mr-3">Generated:</span>
              {["created", "updated", "skipped", "failed"].every(
                (key) =>
                  typeof batchSummary?.[key as keyof BatchSummary] === "number",
              ) ? (
                <>
                  <span className="mr-3 text-success">
                    {batchSummary.created} created
                  </span>
                  <span className="mr-3 text-primary">
                    {batchSummary.updated} updated
                  </span>
                  <span className="mr-3 text-text-secondary">
                    {batchSummary.skipped} skipped
                  </span>
                  <span className="text-destructive">
                    {batchSummary.failed} failed
                  </span>
                </>
              ) : null}
              {batchSummary.reason === "no_platforms" && (
                <span className="ml-2 text-text-secondary">
                  No connected platforms found. Connect accounts in Settings →
                  Connections.
                </span>
              )}
              {batchSummary.reason === "no_dates" && (
                <span className="ml-2 text-text-secondary">
                  No timings or custom dates saved for this campaign.
                </span>
              )}
              {batchSummary.reason === "no_event_date" && (
                <span className="ml-2 text-text-secondary">
                  Timings selected but no event date to anchor them. Add a
                  custom date below and generate.
                </span>
              )}

              {(batchSummary.reason === "no_dates" ||
                batchSummary.reason === "no_event_date") && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="date"
                    className="rounded-md border border-input px-2 py-1 text-sm"
                    value={quickDate}
                    onChange={(e) => setQuickDate(e.target.value)}
                  />
                  <input
                    type="time"
                    className="rounded-md border border-input px-2 py-1 text-sm"
                    value={quickTime}
                    onChange={(e) => setQuickTime(e.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const iso = (() => {
                        try {
                          return new Date(
                            `${quickDate}T${quickTime}`,
                          ).toISOString();
                        } catch {
                          return null;
                        }
                      })();
                      if (!iso) return;
                      setGenerating(true);
                      try {
                        const debug =
                          (searchParams?.get("debug") || "") === "1";
                        const resp = await fetch(
                          `/api/campaigns/${campaignId}/generate-batch${debug ? "?debug=1" : ""}`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              platforms,
                              selectedTimings: [],
                              customDates: [iso],
                            }),
                          },
                        );
                        const json = (await resp
                          .json()
                          .catch(() => ({}))) as Partial<BatchSummary>;
                        setBatchSummary({
                          created:
                            typeof json.created === "number"
                              ? json.created
                              : undefined,
                          updated:
                            typeof json.updated === "number"
                              ? json.updated
                              : undefined,
                          skipped:
                            typeof json.skipped === "number"
                              ? json.skipped
                              : undefined,
                          failed:
                            typeof json.failed === "number"
                              ? json.failed
                              : undefined,
                        });
                      } catch {
                        setBatchSummary({ failed: 1 });
                      }
                      const supabase = createClient();
                      const { data: inserted } = await supabase
                        .from("campaign_posts")
                        .select("*")
                        .eq("campaign_id", campaignId)
                        .order("scheduled_for");
                      if (Array.isArray(inserted))
                        setPosts(inserted as CampaignPost[]);
                      setGenerating(false);
                    }}
                  >
                    Add date & Generate
                  </Button>
                </div>
              )}
            </div>
          )}
          {generating && (
            <div className="mt-2 rounded-md border border-border bg-surface px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <div className="size-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                <span className="font-medium">Generating content</span>
                {generationProgress.total > 0 ? (
                  <span className="text-text-secondary">
                    {generationProgress.current} of {generationProgress.total}
                  </span>
                ) : (
                  <span className="text-text-secondary">Preparing…</span>
                )}
                {(generationProgress.currentPlatform ||
                  generationProgress.currentTiming) && (
                  <span className="text-text-secondary">
                    • {generationProgress.currentTiming}{" "}
                    {generationProgress.currentPlatform &&
                      `• ${generationProgress.currentPlatform}`}
                  </span>
                )}
              </div>
              {generationProgress.total > 0 && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
                  <div
                    className="h-1.5 rounded-full bg-primary transition-all duration-300 ease-out"
                    style={{
                      width: `${(generationProgress.current / generationProgress.total) * 100}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </Container>
      </header>

      <main>
        <Container className="pb-page-pb pt-page-pt">
          {/* Overview removed per product update; focus on per-post review */}

          {/* No Platforms Connected Message */}
          {platforms.length === 0 && !generating ? (
            <div className="py-12 text-center">
              <div className="mx-auto max-w-md rounded-card border border-amber-200 bg-amber-50 p-8">
                <AlertCircle className="mx-auto mb-4 size-12 text-amber-600" />
                <h3 className="mb-2 text-lg font-semibold text-amber-800">
                  No Social Accounts Connected
                </h3>
                <p className="mb-6 text-sm text-amber-700">
                  To generate campaign content, you need to connect at least one
                  social media account. Connect your accounts to start creating
                  platform-optimised posts.
                </p>
                <div className="space-y-3">
                  <a
                    href="/settings/connections"
                    className="inline-flex h-10 items-center rounded-md bg-primary px-3 text-white"
                  >
                    <Link2 className="mr-2 size-4" />
                    Connect Social Accounts
                  </a>
                  <p className="text-xs text-amber-600">
                    Supported platforms: Facebook, Instagram, Google Business
                    Profile
                  </p>
                </div>
              </div>
            </div>
          ) : generating && posts.length === 0 ? (
            <div className="py-10 text-center text-sm text-text-secondary">
              Preparing content… watch the progress above.
            </div>
          ) : posts.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto max-w-lg space-y-4">
                <Sparkles className="mx-auto size-12 text-primary" />
                <h3 className="text-xl font-semibold">
                  No content generated yet
                </h3>
                <p className="text-sm text-text-secondary">
                  Click Generate to create platform-optimised posts for your
                  campaign. You can edit, approve, and publish afterwards.
                </p>
                <div>
                  <Button
                    onClick={() => campaign && generateAllPosts(campaign)}
                    disabled={generating}
                  >
                    <Sparkles className="mr-2 size-4" />
                    Generate Posts
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            // Timeline View (Default for mobile, optional for desktop)
            <div className="space-y-6">
              {uniqueDates.map((d, idx) => {
                const dayPosts = posts
                  .filter((p) => localDateKey(p.scheduled_for) === d)
                  .slice()
                  .sort((a, b) => {
                    const pa =
                      (a.platform === "instagram"
                        ? "instagram_business"
                        : a.platform) || "facebook";
                    const pb =
                      (b.platform === "instagram"
                        ? "instagram_business"
                        : b.platform) || "facebook";
                    const ia = PLATFORM_SORT.indexOf(pa);
                    const ib = PLATFORM_SORT.indexOf(pb);
                    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
                  });
                const scheduledDate = new Date(dayPosts[0]?.scheduled_for || d);

                return (
                  <div key={d} className="relative">
                    {/* Timeline connector */}
                    {idx < uniqueDates.length - 1 && (
                      <div className="absolute bottom-0 left-6 top-16 hidden w-0.5 bg-border md:block" />
                    )}

                    <div className="flex gap-4">
                      {/* Timeline dot */}
                      <div className="hidden size-12 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white md:flex">
                        {idx + 1}
                      </div>

                      {/* Posts for this timing */}
                      <div className="flex-1">
                        {/* Timing Header */}
                        <div className="mb-4">
                          <div className="mb-2 flex items-center gap-3">
                            {/* Mobile timeline indicator */}
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white md:hidden">
                              {idx + 1}
                            </div>
                            <h3 className="text-lg font-semibold">
                              {formatDate(scheduledDate, undefined, {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                              })}
                            </h3>
                          </div>
                          <p className="ml-11 flex items-center gap-2 text-sm text-text-secondary md:ml-0">
                            <Calendar className="size-4" />
                            {formatDate(scheduledDate, undefined, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                          </p>
                        </div>

                        {/* Platform-specific posts */}
                        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                          {dayPosts.map((post) => {
                            const platform =
                              (post.platform === "instagram"
                                ? "instagram_business"
                                : post.platform) || "facebook";
                            const info = platformInfo[platform];
                            const key = `${post.post_timing}-${platform}`;
                            const status = approvalStatus[key] || "pending";
                            const isEditing = editingPost === key;

                            return (
                              <div
                                key={key}
                                className="overflow-hidden rounded-card border bg-card text-card-foreground shadow-card"
                              >
                                {/* Platform Header */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <div
                                      className={`flex size-8 items-center justify-center rounded-card text-white ${info?.color || "bg-gray-600"}`}
                                    >
                                      {info && <info.icon className="size-5" />}
                                    </div>
                                    <span className="font-medium">
                                      {info?.label || platform}
                                    </span>
                                    {/* Approval badge */}
                                    {status === "approved" && (
                                      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-100 px-2 py-0.5 text-[11px] text-green-800">
                                        <Check className="size-3" /> Approved
                                      </span>
                                    )}
                                    {status === "pending" && (
                                      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-yellow-200 bg-yellow-100 px-2 py-0.5 text-[11px] text-yellow-800">
                                        <Clock className="size-3" /> Pending
                                      </span>
                                    )}
                                    {status === "rejected" && (
                                      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] text-red-800">
                                        <X className="size-3" /> Rejected
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    {/* Inline time selector for this post */}
                                    <div className="flex items-center gap-1">
                                      <label
                                        className="text-xs text-text-secondary"
                                        htmlFor={`time-${key}`}
                                      >
                                        Time
                                      </label>
                                      <input
                                        id={`time-${key}`}
                                        type="time"
                                        className="h-8 max-w-[96px] rounded-md border border-input px-2 py-1 text-xs"
                                        value={timeValueFromIso(
                                          post.scheduled_for,
                                        )}
                                        onChange={(e) => {
                                          const newIso = setIsoTime(
                                            post.scheduled_for,
                                            e.target.value,
                                          );
                                          setPosts((prev) =>
                                            prev.map((p) =>
                                              p.post_timing ===
                                                post.post_timing &&
                                              p.platform === platform
                                                ? {
                                                    ...p,
                                                    scheduled_for: newIso,
                                                  }
                                                : p,
                                            ),
                                          );
                                          // Persist to DB and sync queue if this post has an id
                                          (async () => {
                                            try {
                                              if (post.id) {
                                                await fetch("/api/queue/sync", {
                                                  method: "POST",
                                                  headers: {
                                                    "Content-Type":
                                                      "application/json",
                                                  },
                                                  body: JSON.stringify({
                                                    postId: post.id,
                                                    scheduledFor: newIso,
                                                  }),
                                                });
                                              }
                                            } catch {}
                                          })();
                                        }}
                                        step={60}
                                      />
                                    </div>
                                    <button
                                      onClick={() =>
                                        setApprovalStatus((prev) => ({
                                          ...prev,
                                          [key]: "approved",
                                        }))
                                      }
                                      className={`flex size-8 items-center justify-center rounded-full border ${status === "approved" ? "border-success bg-success text-white" : "border-success/40 bg-white text-success hover:bg-success/10"}`}
                                      title="Mark this post as approved"
                                    >
                                      <Check className="size-5" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        setApprovalStatus((prev) => ({
                                          ...prev,
                                          [key]: "rejected",
                                        }))
                                      }
                                      className={`flex size-8 items-center justify-center rounded-full border ${status === "rejected" ? "border-error bg-error text-white" : "border-error/40 bg-white text-error hover:bg-error/10"}`}
                                      title="Mark this post as rejected"
                                    >
                                      <X className="size-5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Image + Content */}
                                <div className="px-5 py-4">
                                  {/* Image block above content to avoid narrow text columns */}
                                  <div className="mb-4">
                                    <div className="relative aspect-square w-full overflow-hidden rounded-card border border-border bg-gray-100">
                                      {post.media_url ||
                                      campaign.hero_image?.file_url ? (
                                        <Image
                                          src={
                                            post.media_url ||
                                            campaign.hero_image?.file_url ||
                                            ""
                                          }
                                          alt="Campaign creative"
                                          fill
                                          sizes="(min-width: 768px) 256px, 100vw"
                                          className="object-cover"
                                        />
                                      ) : (
                                        <div className="flex size-full items-center justify-center text-text-secondary">
                                          <ImageIcon className="size-6" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex justify-end">
                                      <button
                                        onClick={() => {
                                          setSelectedPostKeyForImage(key);
                                          setImageModalOpen(true);
                                        }}
                                        className="mt-2 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-muted"
                                      >
                                        Replace Image
                                      </button>
                                    </div>
                                  </div>
                                  <div>
                                    {isEditing ? (
                                      <textarea
                                        value={post.content || ""}
                                        onChange={(e) =>
                                          updatePostContent(
                                            post.post_timing,
                                            platform,
                                            e.target.value,
                                          )
                                        }
                                        className="min-h-[120px] w-full rounded-md border border-input px-3 py-2 font-body text-sm"
                                      />
                                    ) : (
                                      renderContent(post.content || "")
                                    )}

                                    {/* Character counter + Shorten for platform */}
                                    <div className="mt-3 flex items-center justify-between text-xs text-text-secondary">
                                      <span>
                                        {(post.content || "").length} characters
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Smart suggestions removed; copy includes links/hours automatically */}

                                {/* Actions */}
                                <div className="mt-4 flex items-center justify-end border-t border-border px-5 py-3">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() =>
                                        setEditingPost(isEditing ? null : key)
                                      }
                                      className="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-muted hover:text-primary"
                                      title="Edit"
                                    >
                                      <Edit2 className="size-4" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        regeneratePost(
                                          post.post_timing,
                                          platform,
                                        )
                                      }
                                      disabled={generating}
                                      className="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-muted hover:text-primary disabled:opacity-60"
                                      title="Regenerate"
                                    >
                                      <RefreshCw
                                        className={`${generating ? "animate-spin" : ""} size-4`}
                                      />
                                    </button>
                                    <button
                                      onClick={() =>
                                        copyToClipboard(post.content || "", key)
                                      }
                                      className="inline-flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-muted hover:text-primary"
                                      title="Copy"
                                    >
                                      {copiedPost === key ? (
                                        <Check className="size-4 text-success" />
                                      ) : (
                                        <Copy className="size-4" />
                                      )}
                                    </button>
                                  </div>
                                </div>

                                {/* Feedback Component - Dedicated Section */}
                                <div className="border-t border-border bg-gray-50/30 px-5 py-3">
                                  <ContentFeedback
                                    content={post.content}
                                    platform={platform}
                                    generationType="campaign"
                                    campaignId={campaignId}
                                    onRegenerate={() =>
                                      regeneratePost(post.post_timing, platform)
                                    }
                                    className="border-0 bg-transparent"
                                  />
                                </div>
                              </div>
                            );
                          })}

                          {/* Show generating indicator if still processing */}
                          {generating && generationProgress.total > 0 && (
                            <div className="col-span-full flex items-center justify-center py-8">
                              <div className="flex items-center gap-3 text-text-secondary">
                                <div className="size-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                                <span className="text-sm">
                                  Generating{" "}
                                  {generationProgress.total -
                                    generationProgress.current}{" "}
                                  more posts...
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Container>
      </main>
      {/* Image Selection Modal */}
      {selectedPostKeyForImage && (
        <ImageSelectionModal
          isOpen={imageModalOpen}
          onClose={() => {
            setImageModalOpen(false);
            setSelectedPostKeyForImage(null);
          }}
          onSelect={(imageUrl) => {
            if (!imageUrl) return;
            const [timing, platform] = (selectedPostKeyForImage || "").split(
              "-",
            );
            setPosts((prev) =>
              prev.map((p) =>
                p.post_timing === timing && p.platform === platform
                  ? { ...p, media_url: imageUrl }
                  : p,
              ),
            );
          }}
          currentImageUrl={(() => {
            const [timing, platform] = (selectedPostKeyForImage || "").split(
              "-",
            );
            const p = posts.find(
              (pp) => pp.post_timing === timing && pp.platform === platform,
            );
            return p?.media_url || null;
          })()}
          defaultImageUrl={campaign.hero_image?.file_url}
          postId={selectedPostKeyForImage}
          platform={(() => (selectedPostKeyForImage || "").split("-")[1])()}
        />
      )}
    </div>
  );
}
