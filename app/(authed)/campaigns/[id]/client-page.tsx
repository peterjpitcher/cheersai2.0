"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import Container from "@/components/layout/container";
import {
  Calendar, ChevronLeft, Grid3X3, List,
  PartyPopper, Sparkles, Sun, Megaphone, Image as ImageIcon,
  Check, RefreshCw, Copy, Loader2, Edit2,
  CheckCircle, XCircle, Clock, ThumbsUp, ThumbsDown
} from "lucide-react";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import CampaignActions from "./campaign-actions";
import PostActions from "./post-actions";
import ContentFeedback from "@/components/feedback/content-feedback";
import { PublishAllButton } from "./publish-all-button";
import PlatformBadge from "@/components/ui/platform-badge";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
// import GuardrailsModal from "@/components/campaign/guardrails-modal"; // Uncomment when ready to use
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

export default function CampaignClientPage({ campaign }: CampaignClientPageProps) {
  const [posts, setPosts] = useState<CampaignPost[]>(campaign.campaign_posts || []);
  const [viewMode, setViewMode] = useState<"timeline" | "matrix">("timeline");
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedPostForImage, setSelectedPostForImage] = useState<CampaignPost | null>(null);
  // const [guardrailsModalOpen, setGuardrailsModalOpen] = useState(false);
  // const [selectedPostForGuardrails, setSelectedPostForGuardrails] = useState<any>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<{ [key: string]: string }>({});
  const [approvingPost, setApprovingPost] = useState<string | null>(null);
  
  // Time helpers (local timezone)
  const timeValueFromIso = (iso: string | null) => {
    if (!iso) return '12:00';
    try {
      const d = new Date(iso);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    } catch { return '12:00'; }
  };
  const setIsoTime = (iso: string | null, hhmm: string) => {
    try {
      const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));
      const d = iso ? new Date(iso) : new Date();
      d.setHours(isNaN(hh) ? 12 : hh, isNaN(mm) ? 0 : mm, 0, 0);
      return d.toISOString();
    } catch { return iso ?? new Date().toISOString(); }
  };
  
  // Count posts by approval status
  const pendingApprovalCount = posts.filter((p) => p.approval_status === "pending").length;
  const approvedCount = posts.filter((p) => p.approval_status === "approved").length;
  const rejectedCount = posts.filter((p) => p.approval_status === "rejected").length;
  
  // Count approved draft posts (ready to be scheduled)
  const approvedDraftCount = posts.filter((p) => p.status === "draft" && p.approval_status === "approved").length;
  
  // Auto-detect and switch view mode based on screen size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setViewMode("matrix");
      } else {
        setViewMode("timeline");
      }
    };
    
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  
  const Icon = CAMPAIGN_ICONS[campaign.campaign_type as keyof typeof CAMPAIGN_ICONS] || Calendar;
  const eventDate = campaign.event_date ? new Date(campaign.event_date) : null;
  const isUpcoming = eventDate ? eventDate > new Date() : false;
  const daysUntil = eventDate ? Math.ceil((eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const statusLabel = campaign.status ?? 'draft';

  // Sort posts by scheduled date
  const sortedPosts = [...posts].sort((a, b) => {
    const aTime = a.scheduled_for ? new Date(a.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduled_for ? new Date(b.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  const handleFeedbackSubmit = () => {
    // Optionally refresh or show a success message
    console.log("Feedback submitted successfully");
  };

  const handleImageSelect = async (imageUrl: string | null, assetId: string | null) => {
    if (!selectedPostForImage) return;
    
    const supabase = createClient();
    
    // Update the post with new image
    const { error } = await supabase
      .from("campaign_posts")
      .update({
        media_url: imageUrl,
        media_assets: assetId ? [assetId] : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", selectedPostForImage.id);
    
    if (!error) {
      // Update local state
      setPosts((prevPosts) => prevPosts.map((post) =>
        post.id === selectedPostForImage.id
          ? { ...post, media_url: imageUrl, media_assets: assetId ? [assetId] : null }
          : post
      ));
    }
    
    setImageModalOpen(false);
    setSelectedPostForImage(null);
  };

  const regeneratePost = async (
    postTiming: string,
    platform?: string | null,
  ) => {
    const key = `${postTiming}-${platform || ''}`;
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
        const content: string = json?.data?.content ?? json?.content ?? '';
        setPosts((prevPosts) => prevPosts.map((post) =>
          post.post_timing === postTiming && post.platform === platform
            ? { ...post, content }
            : post
        ));
      }
    } catch (error) {
      console.error("Regeneration failed:", error);
    }
    
    setRegenerating(null);
  };

  const copyToClipboard = async (content: string, key: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedPost(key);
    setTimeout(() => setCopiedPost(null), 2000);
  };

  const saveEditedContent = async (postId: string, newContent: string) => {
    const supabase = createClient();
    
    const { error } = await supabase
      .from("campaign_posts")
      .update({
        content: newContent,
        updated_at: new Date().toISOString()
      })
      .eq("id", postId);
    
    if (!error) {
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType: 'campaign_post', entityId: postId, action: 'edit', meta: { fields: ['content'] } })
        })
      } catch {}
      setPosts((prevPosts) => prevPosts.map((post) =>
        post.id === postId ? { ...post, content: newContent } : post
      ));
      setEditingPost(null);
      setEditedContent({});
    }
  };

  const handleApprovalAction = async (postId: string, action: 'approved' | 'rejected') => {
    setApprovingPost(postId);
    const supabase = createClient();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("campaign_posts")
        .update({
          approval_status: action,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", postId);
      
      if (!error) {
        try { await fetch('/api/audit/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityType: 'campaign_post', entityId: postId, action, meta: {} }) }) } catch {}
        // Get the user's full name for UI update
        const { data: userData } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", user.id)
          .single();

        setPosts((prevPosts) => prevPosts.map((post) =>
          post.id === postId ? {
            ...post,
            approval_status: action,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
            approved_by_user: { full_name: userData?.full_name || 'Unknown' }
          } : post
        ));
      }
    } catch (error) {
      console.error("Approval action failed:", error);
    } finally {
      setApprovingPost(null);
    }
  };

  const getTimingLabel = (timing: string, scheduledDate: Date) => {
    const timingInfo = POST_TIMINGS.find(t => t.id === timing);
    if (timingInfo) return timingInfo.label;

    if (!campaign.event_date) {
      return 'Scheduled Post';
    }

    // For custom dates, calculate relative timing
    const eventDate = new Date(campaign.event_date);
    const daysDiff = Math.round((scheduledDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 0) return "Day Of Event";
    if (daysDiff === 1) return "1 Day After";
    if (daysDiff === -1) return "1 Day Before";
    if (daysDiff > 0) return `${daysDiff} Days After`;
    return `${Math.abs(daysDiff)} Days Before`;
  };

  // Group posts by timing and platform for matrix view
  const getPostsMatrix = () => {
    const matrix: Record<string, Record<string, CampaignPost>> = {};
    const platforms = new Set<string>();

    posts.forEach((post) => {
      if (!matrix[post.post_timing]) {
        matrix[post.post_timing] = {};
      }
      if (post.platform) {
        matrix[post.post_timing][post.platform] = post;
        platforms.add(post.platform);
      }
    });

    return { matrix, platforms: Array.from(platforms).sort() };
  };

  const { matrix: postsMatrix, platforms } = getPostsMatrix();
  const uniqueTimings = Object.keys(postsMatrix).sort((a, b) => {
    const aIndex = POST_TIMINGS.findIndex(t => t.id === a);
    const bIndex = POST_TIMINGS.findIndex(t => t.id === b);
    return aIndex - bIndex;
  });

  // Helper function to get approval status badge
  const getApprovalStatusBadge = (post: CampaignPost) => {
    const status = post.approval_status || 'pending';
    const approvedByName = post.approved_by_user?.full_name ||
      (typeof post.approved_by === 'object' ? post.approved_by?.full_name : undefined);
    
    switch (status) {
      case 'approved':
        return (
          <Badge variant="default" className="border-green-200 bg-green-100 text-green-800" size="sm">
            <CheckCircle className="mr-1 size-3" />
            Approved
            {approvedByName && <span className="ml-1 text-xs">by {approvedByName}</span>}
          </Badge>
        );
      case 'rejected':
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

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="py-6">
          {/* Page Heading (non-sticky, no border to avoid nav clutter) */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/campaigns" className="text-text-secondary hover:text-primary">
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
            <div className="flex items-center gap-2">
              {/* View Mode Toggle - Desktop Only */}
              <div className="hidden rounded-lg border border-border lg:flex">
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                    viewMode === "timeline" 
                      ? "bg-primary text-white" 
                      : "text-text-secondary hover:bg-gray-50"
                  } rounded-l-lg transition-colors`}
                >
                  <List className="size-4" />
                  Timeline
                </button>
                <button
                  onClick={() => setViewMode("matrix")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                    viewMode === "matrix" 
                      ? "bg-primary text-white" 
                      : "text-text-secondary hover:bg-gray-50"
                  } rounded-r-lg transition-colors`}
                >
                  <Grid3X3 className="size-4" />
                  Matrix
                </button>
              </div>
              {approvedDraftCount > 0 && (
                <PublishAllButton 
                  campaignId={campaign.id}
                  approvedDraftCount={approvedDraftCount}
                  onSuccess={async () => {
                    const supabase = createClient();
                    const { data: updatedPosts } = await supabase
                      .from("campaign_posts")
                      .select("*")
                      .eq("campaign_id", campaign.id)
                      .order("scheduled_for");
                    if (updatedPosts) setPosts(updatedPosts);
                  }}
                />
              )}
              <CampaignActions 
                campaignId={campaign.id}
                campaignName={campaign.name}
                posts={sortedPosts}
              />
            </div>
          </div>
        </Container>
        <Container className="py-2">
        {/* Campaign Info Bar */}
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-4 lg:gap-6">
            {/* Event Date & Time */}
            <div className="flex items-center gap-2">
              <Calendar className="size-5 text-primary" />
              <div>
                {eventDate ? (
                  <>
                    <p className="text-sm font-medium">{formatDate(eventDate, undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    {eventDate.getHours() !== 0 && (
                      <p className="text-xs text-text-secondary">{formatTime(eventDate)}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-text-secondary">No event date set</p>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <div className={`size-3 rounded-full ${
                statusLabel === "active" ? "bg-success" : "bg-warning"
              }`} />
              <span className="text-sm font-medium capitalize">{statusLabel}</span>
            </div>

            {/* Posts Count */}
            <div className="text-sm">
              <span className="font-medium">{sortedPosts.length}</span>
              <span className="text-text-secondary"> posts</span>
            </div>

            {/* Approval Status Summary */}
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

            {/* Platforms Count */}
            {platforms.length > 0 && (
              <div className="text-sm">
                <span className="font-medium">{platforms.length}</span>
                <span className="text-text-secondary"> platforms</span>
              </div>
            )}

            {/* Days Until Event */}
            {isUpcoming && (
              <div className="text-sm">
                <span className="font-medium text-primary">{daysUntil}</span>
                <span className="text-text-secondary"> days until event</span>
              </div>
            )}

            {/* Hero Image Thumbnail - Optional */}
            {campaign.hero_image && (
              <div className="ml-auto">
                <button
                  onClick={() => {
                    // Could open a modal to view full image
                  }}
                  className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-primary"
                >
                  <ImageIcon className="size-4" />
                  <span>View Image</span>
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Posts Display - Full Width */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-xl font-bold">Campaign Posts</h2>
            {platforms.length > 0 && viewMode === "matrix" && (
              <div className="text-sm text-text-secondary">
                {uniqueTimings.length} timings × {platforms.length} platforms = {uniqueTimings.length * platforms.length} posts
              </div>
            )}
          </div>
          
          {sortedPosts.length === 0 ? (
            <EmptyState
              title="No posts generated yet"
              body="Generate content for your campaign to see posts here."
              primaryCta={{ label: 'Generate Posts', href: `/campaigns/${campaign.id}/generate` }}
            />
          ) : viewMode === "matrix" && platforms.length > 0 ? (
            // Matrix View - Desktop (Full Width)
            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
              <table className="w-full">
                <thead className="border-b border-border bg-gray-50">
                  <tr>
                    <th className="sticky left-0 z-10 bg-gray-50 p-4 text-left font-medium text-text-primary">
                      Timing
                    </th>
                    {platforms.map(platform => (
                      <th key={platform} className="min-w-[300px] p-4 text-center font-medium">
                        <PlatformBadge platform={platform} size="md" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uniqueTimings.map((timing) => {
                    const firstPost = Object.values(postsMatrix[timing])[0];
                    const scheduledDate = firstPost?.scheduled_for ? new Date(firstPost.scheduled_for) : new Date();
                    const timingLabel = getTimingLabel(timing, scheduledDate);
                    
                    return (
                      <tr key={timing} className="border-b border-border hover:bg-gray-50/50">
                        <td className="sticky left-0 z-10 border-r border-border bg-white p-4 align-top">
                          <div className="font-medium">{timingLabel}</div>
                          <div className="mt-1 text-sm text-text-secondary">{formatDate(scheduledDate, undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                        </td>
                        {platforms.map(platform => {
                          const post = postsMatrix[timing]?.[platform];
                          const key = `${timing}-${platform}`;
                          
                          if (!post) {
                            return (
                              <td key={platform} className="p-4 text-center text-text-secondary">
                                <div className="text-sm">No content</div>
                              </td>
                            );
                          }
                          
                          const imageUrl = post.media_url ?? campaign.hero_image?.file_url ?? undefined

                          return (
                            <td key={platform} className="p-4 align-top">
                              <div className="w-[320px] space-y-3 rounded-lg border border-border bg-white p-4 transition-shadow hover:shadow-md">
                                {/* Approval Status Badge */}
                                <div className="flex items-start justify-between">
                                  {getApprovalStatusBadge(post)}
                                  {post.approval_status === 'pending' && (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleApprovalAction(post.id, 'approved')}
                                        disabled={approvingPost === post.id}
                                        className="rounded p-1 transition-colors hover:bg-green-100"
                                        title="Approve"
                                      >
                                        {approvingPost === post.id ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                          <ThumbsUp className="size-3 text-green-600" />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => handleApprovalAction(post.id, 'rejected')}
                                        disabled={approvingPost === post.id}
                                        className="rounded p-1 transition-colors hover:bg-red-100"
                                        title="Reject"
                                      >
                                        <ThumbsDown className="size-3 text-red-600" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Image Section - Square Aspect Ratio */}
                                {imageUrl && (
                                  <div className="group relative aspect-square">
                                    <Image
                                      src={imageUrl}
                                      alt="Campaign creative"
                                      fill
                                      className="rounded-md object-cover"
                                      sizes="320px"
                                    />
                                    <button
                                      onClick={() => {
                                        setSelectedPostForImage(post);
                                        setImageModalOpen(true);
                                      }}
                                      className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                                    >
                                      <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-900">
                                        <ImageIcon className="size-4" />
                                        Replace Image
                                      </div>
                                    </button>
                                    {post.media_url && (
                                      <Badge className="absolute left-2 top-2" variant="secondary" size="sm">
                                        Custom
                                      </Badge>
                                    )}
                                  </div>
                                )}
                                
                                {/* Content - Editable */}
                                {editingPost === post.id ? (
                                  <div className="space-y-2">
                                    <textarea
                                      value={editedContent[post.id] || post.content}
                                      onChange={(e) => setEditedContent({ ...editedContent, [post.id]: e.target.value })}
                                      className="w-full resize-none rounded-md border p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                      rows={6}
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => saveEditedContent(post.id, editedContent[post.id] || post.content)}
                                        className="rounded bg-primary px-3 py-1 text-sm text-white hover:bg-primary/90"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingPost(null);
                                          setEditedContent({});
                                        }}
                                        className="rounded bg-gray-100 px-3 py-1 text-sm hover:bg-gray-200"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingPost(post.id);
                                      setEditedContent({ ...editedContent, [post.id]: post.content });
                                    }}
                                    className="w-full rounded p-2 text-left text-sm transition-colors hover:bg-gray-50"
                                  >
                                    <span className="whitespace-pre-wrap">
                                      {post.content}
                                    </span>
                                  </button>
                                )}
                                
                                {/* Character count */}
                                <p className="text-xs text-text-secondary">
                                  {(editedContent[post.id] || post.content).length} characters
                                </p>
                                
                                {/* Actions */}
                                <div className="flex items-center justify-between border-t pt-2">
                                  <div className="flex items-center gap-2">
                                    <div className="hidden items-center gap-1 md:flex">
                                      <label className="text-[11px] text-text-secondary" htmlFor={`mx-time-${post.id}`}>Time</label>
                                      <input
                                        id={`mx-time-${post.id}`}
                                        type="time"
                                        className="h-7 rounded-md border border-input px-2 py-0.5 text-[11px]"
                                        value={timeValueFromIso(post.scheduled_for)}
                                        onChange={async (e) => {
                                          const newIso = setIsoTime(post.scheduled_for, e.target.value);
                                          setPosts(prev => prev.map((p) => p.id === post.id ? { ...p, scheduled_for: newIso } : p));
                                          try {
                                            await fetch('/api/queue/sync', {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ postId: post.id, scheduledFor: newIso })
                                            })
                                          } catch {}
                                        }}
                                        step={60}
                                      />
                                    </div>
                                    <button
                                      onClick={() => {
                                        setEditingPost(post.id);
                                        setEditedContent({ ...editedContent, [post.id]: post.content });
                                      }}
                                      className="rounded p-1.5 transition-colors hover:bg-gray-100"
                                      title="Edit"
                                    >
                                      <Edit2 className="size-4" />
                                    </button>
                                    {/* <button
                                      onClick={() => {
                                        // setSelectedPostForGuardrails(post);
                                        // setGuardrailsModalOpen(true);
                                      }}
                                      className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                                      title="Guardrails"
                                    >
                                      <Shield className="w-4 h-4" />
                                    </button> */}
                                    <button
                                      onClick={() =>
                                        regeneratePost(timing, platform || undefined)
                                      }
                                      disabled={regenerating === key}
                                      className="rounded p-1.5 transition-colors hover:bg-gray-100"
                                      title="Regenerate"
                                    >
                                      {regenerating === key ? (
                                        <Loader2 className="size-4 animate-spin" />
                                      ) : (
                                        <RefreshCw className="size-4" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => copyToClipboard(post.content, key)}
                                      className="rounded p-1.5 transition-colors hover:bg-gray-100"
                                      title="Copy"
                                    >
                                      {copiedPost === key ? 
                                        <Check className="size-4 text-success" /> : 
                                        <Copy className="size-4" />
                                      }
                                    </button>
                                  </div>
                                  <PostActions
                                    post={post}
                                    campaignName={campaign.name}
                                    imageUrl={imageUrl}
                                    compact={true}
                                  />
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            // Timeline View (Mobile & Optional Desktop)
            <div className="space-y-4">
              {sortedPosts.map((post, index) => {
                const timing = POST_TIMINGS.find(t => t.id === post.post_timing);
                const scheduledDate = post.scheduled_for ? new Date(post.scheduled_for) : new Date();
                const isPast = scheduledDate < new Date();
                const key = `${post.post_timing}-${post.platform}`;
                const imageUrl = post.media_url ?? campaign.hero_image?.file_url ?? undefined;

                return (
                  <div key={post.id} className="rounded-lg border bg-card text-card-foreground shadow-sm">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <PlatformBadge platform={post.platform} size="sm" />
                          {getApprovalStatusBadge(post)}
                          {post.media_url && (
                            <Badge variant="secondary" size="sm">
                              <ImageIcon className="mr-1 size-3" />
                              Custom Image
                            </Badge>
                          )}
                        </div>
                        <h4 className="flex items-center gap-2 font-semibold">
                          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-white">
                            {index + 1}
                          </span>
                          {timing?.label}
                        </h4>
                        <p className="mt-1 text-sm text-text-secondary">
                          {formatDate(scheduledDate, undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                          {scheduledDate.getHours() !== 0 && (<> at {formatTime(scheduledDate)}</>)}
                          {isPast && (
                            <span className="ml-2 text-text-secondary/50">• Posted</span>
                          )}
                        </p>
                      </div>
                        <div className="flex items-center gap-2">
                          {post.approval_status === 'pending' && (
                            <div className="flex gap-1">
                            <button
                              onClick={() => handleApprovalAction(post.id, 'approved')}
                              disabled={approvingPost === post.id}
                              className="rounded-lg p-2 transition-colors hover:bg-green-100"
                              title="Approve"
                            >
                              {approvingPost === post.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <ThumbsUp className="size-4 text-green-600" />
                              )}
                            </button>
                            <button
                              onClick={() => handleApprovalAction(post.id, 'rejected')}
                              disabled={approvingPost === post.id}
                              className="rounded-lg p-2 transition-colors hover:bg-red-100"
                              title="Reject"
                            >
                              <ThumbsDown className="size-4 text-red-600" />
                            </button>
                          </div>
                        )}
                        {/* Inline time selector */}
                        <div className="mr-1 hidden items-center gap-1 sm:flex">
                          <label className="text-xs text-text-secondary" htmlFor={`time-${post.id}`}>Time</label>
                          <input
                            id={`time-${post.id}`}
                            type="time"
                            className="h-8 rounded-md border border-input px-2 py-1 text-xs"
                            value={timeValueFromIso(post.scheduled_for)}
                            onChange={async (e) => {
                              const newIso = setIsoTime(post.scheduled_for, e.target.value);
                              setPosts(prev => prev.map((p) => p.id === post.id ? { ...p, scheduled_for: newIso } : p));
                              try {
                                await fetch('/api/queue/sync', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ postId: post.id, scheduledFor: newIso })
                                })
                              } catch {}
                            }}
                            step={60}
                          />
                        </div>
                        <button
                          onClick={() => {
                            setSelectedPostForImage(post);
                            setImageModalOpen(true);
                          }}
                          className="rounded-lg p-2 transition-colors hover:bg-gray-100"
                          title="Change Image"
                        >
                          <ImageIcon className="size-5" />
                        </button>
                        <PostActions
                          post={post}
                          campaignName={campaign.name}
                          imageUrl={imageUrl}
                        />
                      </div>
                    </div>
                    
                    {/* Image Preview */}
                    {imageUrl && (
                      <div className="group relative mb-3 h-64 w-full">
                        <Image
                          src={imageUrl}
                          alt="Campaign creative"
                          fill
                          className="rounded-lg object-cover"
                          sizes="(min-width: 768px) 640px, 100vw"
                        />
                        <button
                          onClick={() => {
                            setSelectedPostForImage(post);
                            setImageModalOpen(true);
                          }}
                          className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity active:opacity-100 lg:hidden"
                        >
                          <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-900">
                            <ImageIcon className="size-4" />
                            Replace Image
                          </div>
                        </button>
                      </div>
                    )}
                    
                    <p className="mb-3 whitespace-pre-wrap rounded-soft bg-background p-3 text-text-primary">
                      {post.content}
                    </p>
                    
                    <div className="mb-3 flex items-center justify-between text-sm text-text-secondary">
                      <span>{post.content.length} characters</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() =>
                            regeneratePost(post.post_timing, post.platform ?? undefined)
                          }
                          disabled={regenerating === key}
                          className="rounded p-1.5 transition-colors hover:bg-gray-100"
                          title="Regenerate"
                        >
                          {regenerating === key ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4" />
                          )}
                        </button>
                        <button
                          onClick={() => copyToClipboard(post.content, key)}
                          className="rounded p-1.5 transition-colors hover:bg-gray-100"
                          title="Copy"
                        >
                          {copiedPost === key ? 
                            <Check className="size-4 text-success" /> : 
                            <Copy className="size-4" />
                          }
                        </button>
                      </div>
                    </div>
                    
                    {/* Add feedback component */}
                    <ContentFeedback
                      content={post.content}
                      platform={post.platform ?? undefined}
                      generationType="campaign"
                      campaignId={campaign.id}
                      postId={post.id}
                      onRegenerate={() =>
                        regeneratePost(post.post_timing, post.platform ?? undefined)
                      }
                      onFeedbackSubmit={handleFeedbackSubmit}
                      className="mt-3"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </Container>
      </main>
      
      {/* Image Selection Modal */}
      {selectedPostForImage && (
        <ImageSelectionModal
          isOpen={imageModalOpen}
          onClose={() => {
            setImageModalOpen(false);
            setSelectedPostForImage(null);
          }}
          onSelect={handleImageSelect}
          currentImageUrl={selectedPostForImage?.media_url}
          defaultImageUrl={campaign.hero_image?.file_url}
          postId={selectedPostForImage?.id}
          platform={selectedPostForImage?.platform}
        />
      )}
    </div>
  );
}
