"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import { platformLength, enforcePlatformLimits } from "@/lib/utils/text";
import {
  Sparkles, Clock, Calendar, Edit2, RefreshCw,
  Copy, Download, Check, Loader2, ChevronRight,
  Facebook, Instagram, MapPin,
  Send, Eye, ThumbsUp, X, AlertCircle, Link2, Image as ImageIcon
} from "lucide-react";
import Container from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
import ContentFeedback from "@/components/feedback/content-feedback";
import { formatDate } from "@/lib/datetime";

interface Campaign {
  id: string;
  name: string;
  campaign_type: string;
  event_date: string;
  hero_image?: {
    file_url: string;
  };
}

interface CampaignPost {
  id?: string;
  post_timing: string;
  content: string;
  scheduled_for: string;
  platform?: string;
  status?: string;
  media_url?: string | null;
}

// Platform icons and labels
const platformInfo: { [key: string]: { icon: any; label: string; color: string } } = {
  facebook: { icon: Facebook, label: "Facebook", color: "bg-blue-600" },
  instagram_business: { icon: Instagram, label: "Instagram", color: "bg-gradient-to-br from-purple-600 to-pink-500" },
  google_my_business: { icon: MapPin, label: "Google Business Profile", color: "bg-green-600" },
};

export default function GenerateCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignId = params.id as string;
  
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<string | null>(null);
  // Matrix view removed; always timeline
  const [approvalStatus, setApprovalStatus] = useState<{ [key: string]: "pending" | "approved" | "rejected" | "draft" }>({});
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, currentPlatform: "", currentTiming: "" });
  const [batchSummary, setBatchSummary] = useState<{ created?: number; updated?: number; skipped?: number; failed?: number; reason?: string } | null>(null);
  const [quickDate, setQuickDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [quickTime, setQuickTime] = useState<string>('18:00');
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedPostKeyForImage, setSelectedPostKeyForImage] = useState<string | null>(null);
  const [brandProfile, setBrandProfile] = useState<any | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [campaignLoadError, setCampaignLoadError] = useState<string | null>(null);
  const generateStartedRef = useRef(false);

  // Render plain-text content with real paragraph spacing. We treat two or more
  // consecutive newlines as a paragraph break, and single newlines as line breaks.
  const renderContent = (text: string) => {
    const t = text || '';
    const hasDouble = /\n\s*\n/.test(t);
    const paragraphs = hasDouble ? t.split(/\n\s*\n/) : t.split(/\n+/);
    return (
      <div className="text-sm leading-relaxed">
        {paragraphs.map((para, idx) => (
          <p key={idx} className="mb-3 last:mb-0 whitespace-pre-wrap">
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
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    } catch { return '12:00'; }
  };
  const setIsoTime = (iso: string, hhmm: string) => {
    try {
      const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));
      const d = new Date(iso);
      d.setHours(isNaN(hh) ? 12 : hh, isNaN(mm) ? 0 : mm, 0, 0);
      return d.toISOString();
    } catch { return iso; }
  };

  // Helper to strip simple formatting markers like **bold**, __bold__ and backticks
  const stripFormatting = (text: string) => {
    if (!text) return text;
    let t = text.replace(/\*\*(.*?)\*\*/g, '$1');
    t = t.replace(/__(.*?)__/g, '$1');
    t = t.replace(/`{1,3}([^`]+)`{1,3}/g, '$1');
    return t;
  };

  const sanitizeForPlatform = (platform: string | undefined, text: string): string => {
    if (platform === 'instagram_business') {
      return text.replace(/https?:\/\/\S+|www\.[^\s]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    }
    return text;
  };

  useEffect(() => {
    fetchCampaign();
  }, [campaignId]);

  // Optional auto-start generation via query param (no change to default UX)
  useEffect(() => {
    const auto = searchParams?.get('autostart') || searchParams?.get('auto');
    if (!campaign || generating || loadingInitial) return;
    if (generateStartedRef.current) return;
    if (posts.length > 0) return;
    if (auto) {
      generateStartedRef.current = true;
      // Fire and forget; UI already tracks progress and completion
      generateAllPosts(campaign);
    }
  }, [campaign, posts.length, generating, loadingInitial, searchParams]);

  const fetchCampaign = async () => {
    setCampaignLoadError(null);
    try {
      // Ensure tenant cookies and server context are hydrated
      try { await fetch('/api/tenant/bootstrap', { method: 'GET' }); } catch {}
      const resp = await fetch(`/api/campaigns/${campaignId}/context`, { method: 'GET' });
      if (!resp.ok) {
        if (resp.status === 401) setCampaignLoadError('Not signed in. Please sign in again.');
        else if (resp.status === 404) setCampaignLoadError('Campaign not found or you do not have access.');
        else setCampaignLoadError('Failed to load this campaign.');
        setLoadingInitial(false);
        return;
      }
      const json = await resp.json();
      const ctx = json?.data || json; // ok() wrapper returns { data }
      setCampaign(ctx.campaign);
      setPlatforms(ctx.platforms || []);
      if (ctx.brandProfile) setBrandProfile(ctx.brandProfile);
      const existingPosts = ctx.posts || [];
      setPosts(existingPosts);
      const status: any = {};
      existingPosts.forEach((post: any) => {
        const key = `${post.post_timing}-${post.platform}`;
        status[key] = post.approval_status || 'pending';
      });
      setApprovalStatus(status);
    } catch (e) {
      console.error('fetchCampaign error:', e);
      setCampaignLoadError('Failed to load this campaign.');
    }
    setLoadingInitial(false);
  };

  // Compute opening hours text for a given ISO date string
  const getOpeningHoursForDate = (iso: string): { label: string; text: string | null } => {
    if (!brandProfile?.opening_hours) return { label: '', text: null };
    try {
      const oh: any = brandProfile.opening_hours;
      const d = new Date(iso);
      const today = new Date();
      const yyyy = d.toISOString().split('T')[0];
      const days = ['sun','mon','tue','wed','thu','fri','sat'] as const;
      const dayKey = days[d.getDay()] === 'sun' ? 'sun' : (['sun','mon','tue','wed','thu','fri','sat'][d.getDay()] as any);
      const label = d.toDateString() === today.toDateString() ? 'today' : formatDate(d, undefined, { weekday: 'long' });
      // Exceptions override
      const ex = Array.isArray(oh.exceptions) ? oh.exceptions.find((e: any) => e.date === yyyy) : null;
      if (ex) {
        if (ex.closed) return { label, text: `Closed ${label}` };
        if (ex.open && ex.close) return { label, text: `${ex.open}–${ex.close}` };
      }
      const base = oh[dayKey];
      if (!base) return { label, text: null };
      if (base.closed) return { label, text: `Closed ${label}` };
      if (base.open && base.close) return { label, text: `${base.open}–${base.close}` };
      return { label, text: null };
    } catch {
      return { label: '', text: null };
    }
  };

  // Suggestion actions removed; booking link and event-day hours are baked into generated copy

  const generateAllPosts = async (campaign: Campaign) => {
    setGenerating(true);
    setBatchSummary(null);
    setGenerationProgress({ current: 0, total: 0, currentPlatform: "", currentTiming: "" });

    // Use platforms derived from server context (avoids client-side auth entirely)
    const connectedPlatforms = [...new Set((platforms || []).map(p => p === 'instagram' ? 'instagram_business' : p))]

    const selectedTimings = (campaign as any).selected_timings || ['week_before', 'day_before', 'day_of'];
    const customDates = (campaign as any).custom_dates || [];

    // Pre-compute work items to drive the on-screen progress tracker
    const workItems: Array<{ platform: string; timing: string }> = [];
    for (const t of selectedTimings) {
      for (const p of connectedPlatforms) {
        workItems.push({ platform: p, timing: t });
      }
    }
    for (const _d of customDates) {
      for (const p of connectedPlatforms) {
        workItems.push({ platform: p, timing: 'custom' });
      }
    }
    // Initialise progress UI using the computed total
    if (workItems.length > 0) {
      setGenerationProgress({ current: 0, total: workItems.length, currentPlatform: workItems[0].platform, currentTiming: workItems[0].timing });
    }

    // Progress polling based on actual inserted rows in DB
    // 1) Capture initial count
    let initialCount = 0;
    try {
      const timingsParam = Array.from(new Set([...selectedTimings, ...(customDates.length > 0 ? ['custom'] : [])])).join(',')
      const platformsParam = connectedPlatforms.join(',')
      const resp = await fetch(`/api/campaigns/${campaignId}/post-count?platforms=${encodeURIComponent(platformsParam)}&timings=${encodeURIComponent(timingsParam)}`)
      const json = await resp.json().catch(() => ({}))
      initialCount = json?.data?.count ?? json?.count ?? 0
    } catch {}

    // 2) Start polling during batch generation to reflect real progress
    let progressTimer: any = null;
    if (workItems.length > 0) {
      progressTimer = setInterval(async () => {
        try {
          const timingsParam = Array.from(new Set([...selectedTimings, ...(customDates.length > 0 ? ['custom'] : [])])).join(',')
          const platformsParam = connectedPlatforms.join(',')
          const resp = await fetch(`/api/campaigns/${campaignId}/post-count?platforms=${encodeURIComponent(platformsParam)}&timings=${encodeURIComponent(timingsParam)}`)
          const json = await resp.json().catch(() => ({}))
          const curCt = json?.data?.count ?? json?.count ?? 0
          const createdNow = Math.max(0, (curCt || 0) - initialCount)
          const clamped = Math.min(createdNow, workItems.length)
          const idx = Math.max(0, Math.min(workItems.length - 1, clamped))
          const cur = workItems[idx] || { platform: '', timing: '' }
          setGenerationProgress({
            current: clamped,
            total: workItems.length,
            currentPlatform: cur.platform,
            currentTiming: cur.timing,
          })
        } catch {}
      }, 800)
    }

    try {
      const debug = (searchParams?.get('debug') || '') === '1'
      const resp = await fetch(`/api/campaigns/${campaignId}/generate-batch${debug ? '?debug=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Omit platforms so the server resolves from social_connections (single source of truth)
        body: JSON.stringify({ selectedTimings, customDates })
      })
      const json = await resp.json().catch(() => ({}))
      if (resp.ok) {
        setBatchSummary({ created: json?.created || 0, updated: json?.updated || 0, skipped: json?.skipped || 0, failed: json?.failed || 0, ...(json?.reason ? { reason: json.reason } : {}) } as any)
      } else {
        setBatchSummary({ failed: (json?.items?.length || 0) || 1 } as any)
      }
    } catch (e) {
      setBatchSummary({ failed: 1 })
    }

    // Refresh posts from server context (SSR auth)
    try {
      const ctxResp = await fetch(`/api/campaigns/${campaignId}/context`, { method: 'GET' })
      const ctx = await ctxResp.json().catch(() => ({}))
      const data = ctx?.data || ctx
      if (Array.isArray(data?.posts)) setPosts(data.posts)
    } catch {}

    // Complete and clear progress polling
    if (workItems.length > 0) {
      setGenerationProgress({ current: workItems.length, total: workItems.length, currentPlatform: workItems[workItems.length - 1].platform, currentTiming: workItems[workItems.length - 1].timing });
    }
    if (progressTimer) clearInterval(progressTimer);
    setGenerating(false);
    // Reset progress shortly after completion
    setTimeout(() => setGenerationProgress({ current: 0, total: 0, currentPlatform: "", currentTiming: "" }), 600);
  };

  const regeneratePost = async (postTiming: string, platform?: string) => {
    if (!campaign) return;
    
    setGenerating(true);
    try {
      const debug = (searchParams?.get('debug') || '') === '1'
      const response = await fetch(`/api/generate${debug ? '?debug=1' : ''}` , {
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
        const content: string = json?.data?.content ?? json?.content ?? '';
        const stripped = stripFormatting(content)
        const target = posts.find(p => p.post_timing === postTiming && p.platform === platform)
        if (target?.id) {
          try {
            const supabase = createClient();
            await supabase.from('campaign_posts').update({ content: stripped }).eq('id', target.id)
          } catch {}
        }
        setPosts(posts.map(p => 
          (p.post_timing === postTiming && p.platform === platform) ? { ...p, content: stripped } : p
        ));
      }
    } catch (error) {
      console.error("Regeneration failed:", error);
    }
    setGenerating(false);
  };

  const updatePostContent = (postTiming: string, platform: string, content: string) => {
    setPosts(posts.map(p => 
      (p.post_timing === postTiming && p.platform === platform) ? { ...p, content: stripFormatting(content) } : p
    ));
  };

  const toggleApproval = (postTiming: string, platform: string) => {
    const key = `${postTiming}-${platform}`;
    const currentStatus = approvalStatus[key] || "pending";
    const newStatus = currentStatus === "pending" ? "approved" : 
                     currentStatus === "approved" ? "rejected" : "pending";
    
    setApprovalStatus(prev => ({
      ...prev,
      [key]: newStatus
    }));
    
    // Do not overload scheduling status; keep approval separate in local mapping
  };

  const copyToClipboard = async (content: string, key: string) => {
    await navigator.clipboard.writeText(content || '');
    setCopiedPost(key);
    setTimeout(() => setCopiedPost(null), 2000);
  };

  const saveCampaign = async () => {
    setSaving(true);
    const supabase = createClient();
    // Fetch tenant ID for inserts
    let tenantId: string | null = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id) {
        const { data: u } = await supabase.from('users').select('tenant_id').eq('id', auth.user.id).single();
        tenantId = u?.tenant_id || null;
      }
    } catch {}
    
    try {
      // Save all posts with their approval status
      for (const post of posts) {
        const key = `${post.post_timing}-${post.platform}`;
        const approval = approvalStatus[key] || "pending";
        
        const sanitizedContent = sanitizeForPlatform(post.platform || 'facebook', post.content || '');
        if (post.id) {
          // Update existing post
          await supabase
            .from("campaign_posts")
            .update({ 
              content: sanitizedContent,
              approval_status: approval,
              media_url: post.media_url ?? null
            })
            .eq("id", post.id);
        } else {
          // Create new post with platform and status
          await supabase
            .from("campaign_posts")
            .insert({
              campaign_id: campaignId,
              post_timing: post.post_timing,
              content: sanitizedContent,
              scheduled_for: post.scheduled_for,
              platform: post.platform || 'facebook',
              status: 'draft',
              approval_status: approval,
              media_url: post.media_url || campaign?.hero_image?.file_url || null,
              tenant_id: tenantId,
            });
        }
      }

      // Update campaign status
      await supabase
        .from("campaigns")
        .update({ status: "active" })
        .eq("id", campaignId);

      // Immediately schedule approved drafts for this campaign
      try {
        await supabase
          .from('campaign_posts')
          .update({ status: 'scheduled', updated_at: new Date().toISOString() })
          .eq('campaign_id', campaignId)
          .eq('status', 'draft')
          .eq('approval_status', 'approved');

        // Enqueue publishing jobs for each connected account matching the post platform
        // 1) Load scheduled, approved posts
        const { data: schedPosts } = await supabase
          .from('campaign_posts')
          .select('id, platform, scheduled_for, media_url, media_assets')
          .eq('campaign_id', campaignId)
          .eq('status', 'scheduled')
          .eq('approval_status', 'approved');

        // 2) Load active connections for tenant
        const { data: { user } } = await supabase.auth.getUser();
        let tenantIdLocal: string | null = null;
        if (user) {
          const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle();
          tenantIdLocal = u?.tenant_id || null;
        }
        const { data: conns } = await supabase
          .from('social_connections')
          .select('id, platform')
          .eq('tenant_id', tenantIdLocal)
          .eq('is_active', true);

        // 3) Avoid duplicate queue items
        const postIds = (schedPosts || []).map(p => p.id);
        let existing: Array<{ campaign_post_id: string; social_connection_id: string }> = [];
        if (postIds.length > 0) {
          const { data: existingRows } = await supabase
            .from('publishing_queue')
            .select('campaign_post_id, social_connection_id')
            .in('campaign_post_id', postIds);
          existing = existingRows || [];
        }

        // 4) Build new queue items
        const items: any[] = [];
        for (const p of (schedPosts || [])) {
          const targetPlatform = (p.platform === 'instagram' ? 'instagram_business' : p.platform) || 'facebook';
          for (const c of (conns || [])) {
            const connPlatform = c.platform === 'instagram' ? 'instagram_business' : c.platform;
            if (connPlatform !== targetPlatform) continue;
            // Guard: Instagram requires an image; skip enqueue if missing
            if ((connPlatform === 'instagram_business' || connPlatform === 'instagram') && !p.media_url && (!(p as any).media_assets || ((p as any).media_assets || []).length === 0)) {
              continue;
            }
            const exists = existing.some(e => e.campaign_post_id === p.id && e.social_connection_id === c.id);
            if (!exists) {
              items.push({
                campaign_post_id: p.id,
                social_connection_id: c.id,
                scheduled_for: p.scheduled_for,
                status: 'pending',
              });
            }
          }
        }
        if (items.length > 0) {
          await supabase.from('publishing_queue').insert(items);
        }
      } catch {}

      // Redirect to dashboard (posting calendar) after scheduling
      router.push('/dashboard');
    } catch (error) {
      console.error("Save failed:", error);
      setSaveError("Failed to save campaign");
    }
    setSaving(false);
  };

  const downloadAllPosts = () => {
    const content = posts.map(post => {
      const timing = POST_TIMINGS.find(t => t.id === post.post_timing) || { label: "Custom" };
      const date = formatDate(post.scheduled_for);
      const platform = platformInfo[post.platform || "facebook"]?.label || post.platform;
      return `${timing.label} - ${platform} (${date})\n${'-'.repeat(40)}\n${post.content || ''}\n`;
    }).join('\n\n');

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaign?.name.replace(/\s+/g, "-")}-posts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Unique timings present in current posts (sorted by POST_TIMINGS order, then custom at end)
  // Build chronological groups by the calendar date (YYYY-MM-DD) of scheduled_for
  const sortedPosts = [...posts].sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  const dateKey = (iso: string) => new Date(iso).toISOString().split('T')[0];
  const uniqueDates = Array.from(new Set(sortedPosts.map(p => dateKey(p.scheduled_for))));

  if (campaignLoadError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold">Unable to load campaign</h2>
          <p className="text-sm text-text-secondary">{campaignLoadError}</p>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={fetchCampaign} variant="default" size="sm">Retry</Button>
            <Button onClick={() => router.push('/campaigns')} variant="outline" size="sm">Back to campaigns</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!campaign || loadingInitial) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div 
                  key={i}
                  className="w-4 h-4 bg-primary rounded-full animate-pulse"
                  style={{
                    animationDelay: `${i * 0.2}s`,
                    animationDuration: '1s'
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
      <header className="border-b border-border bg-surface sticky top-0 z-[9]">
        <Container className="py-3">
          {batchSummary && (
            <div className="text-sm border border-border rounded-md px-3 py-2 bg-surface">
              <span className="mr-3">Generated:</span>
              {typeof (batchSummary as any).created === 'number' && typeof (batchSummary as any).updated === 'number' && typeof (batchSummary as any).skipped === 'number' && typeof (batchSummary as any).failed === 'number' ? (
                <>
                  <span className="mr-3 text-success">{(batchSummary as any).created} created</span>
                  <span className="mr-3 text-primary">{(batchSummary as any).updated} updated</span>
                  <span className="mr-3 text-text-secondary">{(batchSummary as any).skipped} skipped</span>
                  <span className="text-destructive">{(batchSummary as any).failed} failed</span>
                </>
              ) : null}
              {(batchSummary as any).reason === 'no_platforms' && (
                <span className="ml-2 text-text-secondary">No connected platforms found. Connect accounts in Settings → Connections.</span>
              )}
              {(batchSummary as any).reason === 'no_dates' && (
                <span className="ml-2 text-text-secondary">No timings or custom dates saved for this campaign.</span>
              )}
              {(batchSummary as any).reason === 'no_event_date' && (
                <span className="ml-2 text-text-secondary">Timings selected but no event date to anchor them. Add a custom date below and generate.</span>
              )}

              {(['no_dates','no_event_date'] as const).includes((batchSummary as any).reason as any) && (
                <div className="mt-2 flex items-center gap-2">
                  <input type="date" className="border border-input rounded-md px-2 py-1 text-sm" value={quickDate} onChange={(e) => setQuickDate(e.target.value)} />
                  <input type="time" className="border border-input rounded-md px-2 py-1 text-sm" value={quickTime} onChange={(e) => setQuickTime(e.target.value)} />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const iso = (() => { try { return new Date(`${quickDate}T${quickTime}`).toISOString() } catch { return null } })()
                      if (!iso) return;
                      setGenerating(true)
                      try {
                        const debug = (searchParams?.get('debug') || '') === '1'
                        const resp = await fetch(`/api/campaigns/${campaignId}/generate-batch${debug ? '?debug=1' : ''}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ platforms, selectedTimings: [], customDates: [iso] })
                        })
                        const json = await resp.json().catch(() => ({}))
                        setBatchSummary({ created: json?.created || 0, updated: json?.updated || 0, skipped: json?.skipped || 0, failed: json?.failed || 0 } as any)
                      } catch {
                        setBatchSummary({ failed: 1 } as any)
                      }
                      const supabase = createClient();
                      const { data: inserted } = await supabase
                        .from('campaign_posts')
                        .select('*')
                        .eq('campaign_id', campaignId)
                        .order('scheduled_for')
                      if (inserted) setPosts(inserted as any)
                      setGenerating(false)
                    }}
                  >
                    Add date & Generate
                  </Button>
                </div>
              )}
            </div>
          )}
          {generating && (
            <div className="mt-2 border border-border rounded-md px-3 py-2 bg-surface">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                <span className="font-medium">Generating content</span>
                {generationProgress.total > 0 ? (
                  <span className="text-text-secondary">{generationProgress.current} of {generationProgress.total}</span>
                ) : (
                  <span className="text-text-secondary">Preparing…</span>
                )}
                {(generationProgress.currentPlatform || generationProgress.currentTiming) && (
                  <span className="text-text-secondary">• {generationProgress.currentTiming} {generationProgress.currentPlatform && `• ${generationProgress.currentPlatform}`}</span>
                )}
              </div>
              {generationProgress.total > 0 && (
                <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {saveError && (
            <div className="mt-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-card p-3">
              {saveError}
            </div>
          )}
        </Container>
      </header>

      <main>
        <Container className="pt-page-pt pb-page-pb">
        {/* Overview removed per product update; focus on per-post review */}

        {/* No Platforms Connected Message */}
        {platforms.length === 0 && !generating ? (
          <div className="text-center py-12">
            <div className="bg-amber-50 border border-amber-200 rounded-card p-8 max-w-md mx-auto">
              <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-amber-800 mb-2">
                No Social Accounts Connected
              </h3>
              <p className="text-sm text-amber-700 mb-6">
                To generate campaign content, you need to connect at least one social media account. 
                Connect your accounts to start creating platform-optimised posts.
              </p>
              <div className="space-y-3">
                <a
                  href="/settings/connections"
                  className="bg-primary text-white rounded-md h-10 px-3 inline-flex items-center"
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  Connect Social Accounts
                </a>
                <p className="text-xs text-amber-600">
                  Supported platforms: Facebook, Instagram, Google Business Profile
                </p>
              </div>
            </div>
          </div>
        ) : generating && posts.length === 0 ? (
          <div className="text-center py-10 text-sm text-text-secondary">
            Preparing content… watch the progress above.
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <div className="max-w-lg mx-auto space-y-4">
              <Sparkles className="w-12 h-12 text-primary mx-auto" />
              <h3 className="text-xl font-semibold">No content generated yet</h3>
              <p className="text-sm text-text-secondary">
                Click Generate to create platform-optimised posts for your campaign. You can edit, approve, and publish afterwards.
              </p>
              <div>
                <Button onClick={() => campaign && generateAllPosts(campaign)} disabled={generating}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Posts
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Timeline View (Default for mobile, optional for desktop)
          <div className="space-y-6">
            {uniqueDates.map((d, idx) => {
              const dayPosts = sortedPosts.filter(p => dateKey(p.scheduled_for) === d);
              const scheduledDate = new Date(dayPosts[0]?.scheduled_for || d);
              
              return (
                <div key={d} className="relative">
                  {/* Timeline connector */}
                  {idx < uniqueDates.length - 1 && (
                    <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-border hidden md:block" />
                  )}
                  
                  <div className="flex gap-4">
                    {/* Timeline dot */}
                    <div className="flex-shrink-0 w-12 h-12 bg-primary rounded-full items-center justify-center text-white font-bold hidden md:flex">
                      {idx + 1}
                    </div>
                    
                    {/* Posts for this timing */}
                    <div className="flex-1">
                      {/* Timing Header */}
                      <div className="mb-4">
                        <div className="flex items-center gap-3 mb-2">
                          {/* Mobile timeline indicator */}
                          <div className="flex-shrink-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-bold md:hidden">
                            {idx + 1}
                          </div>
                          <h3 className="font-semibold text-lg">{formatDate(scheduledDate, undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                        </div>
                        <p className="text-sm text-text-secondary flex items-center gap-2 md:ml-0 ml-11">
                          <Calendar className="w-4 h-4" />
                          {formatDate(scheduledDate, undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      
                      {/* Platform-specific posts */}
                      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                        {dayPosts.map((post) => {
                          const platform = (post.platform === 'instagram' ? 'instagram_business' : post.platform) || "facebook";
                          const info = platformInfo[platform];
                          const key = `${post.post_timing}-${platform}`;
                          const status = approvalStatus[key] || "pending";
                          const isEditing = editingPost === key;
                          
                          return (
                            <div key={key} className="rounded-card border bg-card text-card-foreground shadow-card overflow-hidden">
                              {/* Platform Header */}
                              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-8 h-8 rounded-card flex items-center justify-center text-white ${info?.color || "bg-gray-600"}`}>
                                    {info && <info.icon className="w-5 h-5" />}
                                  </div>
                                  <span className="font-medium">{info?.label || platform}</span>
                                  {/* Approval badge */}
                                  {status === 'approved' && (
                                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-green-100 text-green-800 border border-green-200">
                                      <Check className="w-3 h-3" /> Approved
                                    </span>
                                  )}
                                  {status === 'pending' && (
                                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-yellow-100 text-yellow-800 border border-yellow-200">
                                      <Clock className="w-3 h-3" /> Pending
                                    </span>
                                  )}
                                  {status === 'rejected' && (
                                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-200">
                                      <X className="w-3 h-3" /> Rejected
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {/* Inline time selector for this post */}
                                  <div className="flex items-center gap-1">
                                    <label className="text-xs text-text-secondary" htmlFor={`time-${key}`}>Time</label>
                                    <input
                                      id={`time-${key}`}
                                      type="time"
                                      className="h-8 text-xs border border-input rounded-md px-2 py-1 max-w-[96px]"
                                      value={timeValueFromIso(post.scheduled_for)}
                                      onChange={(e) => {
                                        const newIso = setIsoTime(post.scheduled_for, e.target.value);
                                        setPosts(prev => prev
                                          .map(p => (p.post_timing === post.post_timing && p.platform === platform) ? { ...p, scheduled_for: newIso } : p)
                                          .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())
                                        );
                                        // Persist to DB and sync queue if this post has an id
                                        (async () => {
                                          try {
                                            if (post.id) {
                                              await fetch('/api/queue/sync', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ postId: post.id, scheduledFor: newIso })
                                              })
                                            }
                                          } catch {}
                                        })();
                                      }}
                                      step={60}
                                    />
                                  </div>
                                  <button
                                    onClick={() => setApprovalStatus(prev => ({ ...prev, [key]: 'approved' }))}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center border ${status === 'approved' ? 'bg-success text-white border-success' : 'bg-white text-success border-success/40 hover:bg-success/10'}`}
                                    title="Mark this post as approved"
                                  >
                                    <Check className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() => setApprovalStatus(prev => ({ ...prev, [key]: 'rejected' }))}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center border ${status === 'rejected' ? 'bg-error text-white border-error' : 'bg-white text-error border-error/40 hover:bg-error/10'}`}
                                    title="Mark this post as rejected"
                                  >
                                    <X className="w-5 h-5" />
                                  </button>
                                </div>
                              </div>
                              
                          {/* Image + Content */}
                          <div className="px-5 py-4">
                                {/* Image block above content to avoid narrow text columns */}
                                <div className="mb-4">
                                  <div className="aspect-square w-full rounded-card overflow-hidden bg-gray-100 border border-border">
                                    {(post.media_url || campaign.hero_image?.file_url) ? (
                                      <img
                                        src={post.media_url || campaign.hero_image?.file_url || ''}
                                        alt="Post image"
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-text-secondary">
                                        <ImageIcon className="w-6 h-6" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex justify-end">
                                    <button
                                      onClick={() => { setSelectedPostKeyForImage(key); setImageModalOpen(true); }}
                                      className="mt-2 text-xs text-text-secondary hover:bg-muted rounded-md px-2 py-1"
                                    >
                                      Replace Image
                                    </button>
                                  </div>
                                </div>
                                <div>
                                  {isEditing ? (
                                  <textarea
                                      value={post.content || ''}
                                      onChange={(e) => updatePostContent(post.post_timing, platform, e.target.value)}
                                      className="min-h-[120px] font-body text-sm border border-input rounded-md px-3 py-2 w-full"
                                      autoFocus
                                    />
                                  ) : (
                                    renderContent(post.content || '')
                                  )}
                                  
                                  {/* Character counter + Shorten for platform */}
                                  <div className="flex items-center justify-between mt-3 text-xs text-text-secondary">
                                    <span>{(post.content || '').length} characters</span>
                                  </div>
                                </div>
                                </div>
                                
                                {/* Smart suggestions removed; copy includes links/hours automatically */}
                                
                                {/* Actions */}
                                <div className="mt-4 px-5 py-3 border-t border-border flex items-center justify-end">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setEditingPost(isEditing ? null : key)}
                                      className="w-9 h-9 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-primary hover:bg-muted transition-colors"
                                      title="Edit"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => regeneratePost(post.post_timing, platform)}
                                      disabled={generating}
                                      className="w-9 h-9 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-primary hover:bg-muted transition-colors disabled:opacity-60"
                                      title="Regenerate"
                                    >
                                      <RefreshCw className={`${generating ? "animate-spin" : ""} w-4 h-4`} />
                                    </button>
                                    <button
                                      onClick={() => copyToClipboard(post.content || '', key)}
                                      className="w-9 h-9 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-primary hover:bg-muted transition-colors"
                                      title="Copy"
                                    >
                                      {copiedPost === key ? (
                                        <Check className="w-4 h-4 text-success" />
                                      ) : (
                                        <Copy className="w-4 h-4" />
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
                                  onRegenerate={() => regeneratePost(post.post_timing, platform)}
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
                              <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                              <span className="text-sm">
                                Generating {generationProgress.total - generationProgress.current} more posts...
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
          onClose={() => { setImageModalOpen(false); setSelectedPostKeyForImage(null); }}
          onSelect={(imageUrl) => {
            if (!imageUrl) return;
            const [timing, platform] = (selectedPostKeyForImage || '').split('-');
            setPosts(prev => prev.map(p => (
              p.post_timing === timing && p.platform === platform
                ? { ...p, media_url: imageUrl }
                : p
            )));
          }}
          currentImageUrl={(() => {
            const [timing, platform] = (selectedPostKeyForImage || '').split('-');
            const p = posts.find(pp => pp.post_timing === timing && pp.platform === platform);
            return p?.media_url || null;
          })()}
          defaultImageUrl={campaign.hero_image?.file_url}
          postId={selectedPostKeyForImage}
          platform={(() => (selectedPostKeyForImage || '').split('-')[1])()}
        />
      )}
    </div>
  );
}
