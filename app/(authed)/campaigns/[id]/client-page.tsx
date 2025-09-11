"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatDate, formatTime } from "@/lib/datetime";
import Container from "@/components/layout/container";
import {
  Calendar, ChevronLeft, Grid3X3, List,
  PartyPopper, Sparkles, Sun, Megaphone, Image as ImageIcon,
  Check, RefreshCw, Copy, Loader2, Shield, Edit2,
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

const CAMPAIGN_ICONS = {
  event: PartyPopper,
  special: Sparkles,
  seasonal: Sun,
  announcement: Megaphone,
};

interface CampaignClientPageProps {
  campaign: any;
}

export default function CampaignClientPage({ campaign }: CampaignClientPageProps) {
  const [posts, setPosts] = useState(campaign.campaign_posts || []);
  const [viewMode, setViewMode] = useState<"timeline" | "matrix">("timeline");
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedPostForImage, setSelectedPostForImage] = useState<any>(null);
  // const [guardrailsModalOpen, setGuardrailsModalOpen] = useState(false);
  // const [selectedPostForGuardrails, setSelectedPostForGuardrails] = useState<any>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<{ [key: string]: string }>({});
  const [approvingPost, setApprovingPost] = useState<string | null>(null);
  
  // Count posts by status
  const draftCount = posts.filter((p: any) => p.status === "draft").length;
  // const scheduledCount = posts.filter((p: any) => p.status === "scheduled").length;
  // const publishedCount = posts.filter((p: any) => p.status === "published").length;
  
  // Count posts by approval status
  const pendingApprovalCount = posts.filter((p: any) => p.approval_status === "pending").length;
  const approvedCount = posts.filter((p: any) => p.approval_status === "approved").length;
  const rejectedCount = posts.filter((p: any) => p.approval_status === "rejected").length;
  
  // Count approved draft posts (ready to be scheduled)
  const approvedDraftCount = posts.filter((p: any) => p.status === "draft" && p.approval_status === "approved").length;
  
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
  const eventDate = new Date(campaign.event_date);
  const isUpcoming = eventDate > new Date();
  const daysUntil = Math.ceil((eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  // Sort posts by scheduled date
  const sortedPosts = posts.sort((a: any, b: any) => 
    new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
  );

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
      setPosts(posts.map((p: any) => 
        p.id === selectedPostForImage.id 
          ? { ...p, media_url: imageUrl, media_assets: assetId ? [assetId] : null }
          : p
      ));
    }
    
    setImageModalOpen(false);
    setSelectedPostForImage(null);
  };

  const regeneratePost = async (postTiming: string, platform?: string) => {
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
        setPosts(posts.map((p: any) => 
          (p.post_timing === postTiming && p.platform === platform) ? { ...p, content } : p
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
      setPosts(posts.map((p: any) => 
        p.id === postId ? { ...p, content: newContent } : p
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

        setPosts(posts.map((p: any) => 
          p.id === postId ? { 
            ...p, 
            approval_status: action,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
            approved_by_user: { full_name: userData?.full_name || 'Unknown' }
          } : p
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
    const matrix: { [timing: string]: { [platform: string]: any } } = {};
    const platforms = new Set<string>();
    
    posts.forEach((post: any) => {
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
  const getApprovalStatusBadge = (post: any) => {
    const status = post.approval_status || 'pending';
    const approvedByName = post.approved_by_user?.full_name || post.approved_by?.full_name;
    
    switch (status) {
      case 'approved':
        return (
          <Badge variant="default" className="bg-green-100 text-green-800 border-green-200" size="sm">
            <CheckCircle className="w-3 h-3 mr-1" />
            Approved
            {approvedByName && <span className="ml-1 text-xs">by {approvedByName}</span>}
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200" size="sm">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected
            {approvedByName && <span className="ml-1 text-xs">by {approvedByName}</span>}
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200" size="sm">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/campaigns" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">{campaign.name}</h1>
                <p className="text-sm text-text-secondary flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {campaign.campaign_type.charAt(0).toUpperCase() + campaign.campaign_type.slice(1)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View Mode Toggle - Desktop Only */}
              <div className="hidden lg:flex border border-border rounded-lg">
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${
                    viewMode === "timeline" 
                      ? "bg-primary text-white" 
                      : "text-text-secondary hover:bg-gray-50"
                  } rounded-l-lg transition-colors`}
                >
                  <List className="w-4 h-4" />
                  Timeline
                </button>
                <button
                  onClick={() => setViewMode("matrix")}
                  className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${
                    viewMode === "matrix" 
                      ? "bg-primary text-white" 
                      : "text-text-secondary hover:bg-gray-50"
                  } rounded-r-lg transition-colors`}
                >
                  <Grid3X3 className="w-4 h-4" />
                  Matrix
                </button>
              </div>
              {approvedDraftCount > 0 && (
                <PublishAllButton 
                  campaignId={campaign.id}
                  draftCount={draftCount}
                  approvedDraftCount={approvedDraftCount}
                  onSuccess={async () => {
                    // Refresh posts from database
                    const supabase = createClient();
                    const { data: updatedPosts } = await supabase
                      .from("campaign_posts")
                      .select("*")
                      .eq("campaign_id", campaign.id)
                      .order("scheduled_for");
                    
                    if (updatedPosts) {
                      setPosts(updatedPosts);
                    }
                  }}
                />
              )}
              <CampaignActions 
                campaignId={campaign.id}
                campaignName={campaign.name}
                campaignStatus={campaign.status}
                posts={sortedPosts}
              />
            </div>
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-8">
        {/* Campaign Info Bar */}
        <div className="bg-surface border border-border rounded-lg p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4 lg:gap-6">
            {/* Event Date & Time */}
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm font-medium">{formatDate(eventDate, undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                {eventDate.getHours() !== 0 && (
                  <p className="text-xs text-text-secondary">{formatTime(eventDate)}</p>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                campaign.status === "active" ? "bg-success" : "bg-warning"
              }`} />
              <span className="text-sm font-medium capitalize">{campaign.status}</span>
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
                  className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>View Image</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Posts Display - Full Width */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-heading font-bold">Campaign Posts</h2>
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
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className="text-left p-4 font-medium text-text-primary sticky left-0 bg-gray-50 z-10">
                      Timing
                    </th>
                    {platforms.map(platform => (
                      <th key={platform} className="text-center p-4 font-medium min-w-[300px]">
                        <PlatformBadge platform={platform} size="md" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uniqueTimings.map((timing, timingIdx) => {
                    const firstPost = Object.values(postsMatrix[timing])[0];
                    const scheduledDate = firstPost ? new Date(firstPost.scheduled_for) : new Date();
                    const timingLabel = getTimingLabel(timing, scheduledDate);
                    
                    return (
                      <tr key={timing} className="border-b border-border hover:bg-gray-50/50">
                        <td className="p-4 align-top sticky left-0 bg-white z-10 border-r border-border">
                          <div className="font-medium">{timingLabel}</div>
                          <div className="text-sm text-text-secondary mt-1">{formatDate(scheduledDate, undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
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
                          
                          return (
                            <td key={platform} className="p-4 align-top">
                              <div className="bg-white border border-border rounded-lg p-4 space-y-3 hover:shadow-md transition-shadow">
                                {/* Approval Status Badge */}
                                <div className="flex justify-between items-start">
                                  {getApprovalStatusBadge(post)}
                                  {post.approval_status === 'pending' && (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleApprovalAction(post.id, 'approved')}
                                        disabled={approvingPost === post.id}
                                        className="p-1 hover:bg-green-100 rounded transition-colors"
                                        title="Approve"
                                      >
                                        {approvingPost === post.id ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <ThumbsUp className="w-3 h-3 text-green-600" />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => handleApprovalAction(post.id, 'rejected')}
                                        disabled={approvingPost === post.id}
                                        className="p-1 hover:bg-red-100 rounded transition-colors"
                                        title="Reject"
                                      >
                                        <ThumbsDown className="w-3 h-3 text-red-600" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Image Section - Square Aspect Ratio */}
                                {(post.media_url || campaign.hero_image?.file_url) && (
                                  <div className="relative group aspect-square">
                                    <img
                                      src={post.media_url || campaign.hero_image?.file_url}
                                      alt="Post image"
                                      className="w-full h-full object-cover rounded-md"
                                    />
                                    <button
                                      onClick={() => {
                                        setSelectedPostForImage(post);
                                        setImageModalOpen(true);
                                      }}
                                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-md"
                                    >
                                      <div className="bg-white text-gray-900 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-sm font-medium">
                                        <ImageIcon className="w-4 h-4" />
                                        Replace Image
                                      </div>
                                    </button>
                                    {post.media_url && (
                                      <Badge className="absolute top-2 left-2" variant="secondary" size="sm">
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
                                      className="w-full p-2 text-sm border rounded-md resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                      rows={6}
                                      autoFocus
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => saveEditedContent(post.id, editedContent[post.id] || post.content)}
                                        className="px-3 py-1 bg-primary text-white text-sm rounded hover:bg-primary/90"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingPost(null);
                                          setEditedContent({});
                                        }}
                                        className="px-3 py-1 bg-gray-100 text-sm rounded hover:bg-gray-200"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => {
                                      setEditingPost(post.id);
                                      setEditedContent({ ...editedContent, [post.id]: post.content });
                                    }}
                                    className="text-sm cursor-text hover:bg-gray-50 p-2 rounded transition-colors"
                                  >
                                    {post.content}
                                  </div>
                                )}
                                
                                {/* Character count */}
                                <p className="text-xs text-text-secondary">
                                  {(editedContent[post.id] || post.content).length} characters
                                </p>
                                
                                {/* Actions */}
                                <div className="flex items-center justify-between pt-2 border-t">
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => {
                                        setEditingPost(post.id);
                                        setEditedContent({ ...editedContent, [post.id]: post.content });
                                      }}
                                      className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                                      title="Edit"
                                    >
                                      <Edit2 className="w-4 h-4" />
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
                                      onClick={() => regeneratePost(timing, platform)}
                                      disabled={regenerating === key}
                                      className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                                      title="Regenerate"
                                    >
                                      {regenerating === key ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <RefreshCw className="w-4 h-4" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => copyToClipboard(post.content, key)}
                                      className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                                      title="Copy"
                                    >
                                      {copiedPost === key ? 
                                        <Check className="w-4 h-4 text-success" /> : 
                                        <Copy className="w-4 h-4" />
                                      }
                                    </button>
                                  </div>
                                  <PostActions
                                    post={post}
                                    campaignName={campaign.name}
                                    imageUrl={post.media_url || campaign.hero_image?.file_url}
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
              {sortedPosts.map((post: any, index: number) => {
                const timing = POST_TIMINGS.find(t => t.id === post.post_timing);
                const scheduledDate = new Date(post.scheduled_for);
                const isPast = scheduledDate < new Date();
                const key = `${post.post_timing}-${post.platform}`;

                return (
                  <div key={post.id} className="rounded-lg border bg-card text-card-foreground shadow-sm">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <PlatformBadge platform={post.platform} size="sm" />
                          {getApprovalStatusBadge(post)}
                          {post.media_url && (
                            <Badge variant="secondary" size="sm">
                              <ImageIcon className="w-3 h-3 mr-1" />
                              Custom Image
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-semibold flex items-center gap-2">
                          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
                            {index + 1}
                          </span>
                          {timing?.label}
                        </h4>
                        <p className="text-sm text-text-secondary mt-1">
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
                              className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                              title="Approve"
                            >
                              {approvingPost === post.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <ThumbsUp className="w-4 h-4 text-green-600" />
                              )}
                            </button>
                            <button
                              onClick={() => handleApprovalAction(post.id, 'rejected')}
                              disabled={approvingPost === post.id}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                              title="Reject"
                            >
                              <ThumbsDown className="w-4 h-4 text-red-600" />
                            </button>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            setSelectedPostForImage(post);
                            setImageModalOpen(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Change Image"
                        >
                          <ImageIcon className="w-5 h-5" />
                        </button>
                        <PostActions
                          post={post}
                          campaignName={campaign.name}
                          imageUrl={post.media_url || campaign.hero_image?.file_url}
                        />
                      </div>
                    </div>
                    
                    {/* Image Preview */}
                    {(post.media_url || campaign.hero_image?.file_url) && (
                      <div className="relative mb-3 group">
                        <img
                          src={post.media_url || campaign.hero_image?.file_url}
                          alt="Post image"
                          className="w-full max-h-64 object-cover rounded-lg"
                        />
                        <button
                          onClick={() => {
                            setSelectedPostForImage(post);
                            setImageModalOpen(true);
                          }}
                          className="lg:hidden absolute inset-0 bg-black/50 opacity-0 active:opacity-100 transition-opacity flex items-center justify-center rounded-lg"
                        >
                          <div className="bg-white text-gray-900 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-sm font-medium">
                            <ImageIcon className="w-4 h-4" />
                            Replace Image
                          </div>
                        </button>
                      </div>
                    )}
                    
                    <p className="whitespace-pre-wrap text-text-primary bg-background rounded-soft p-3 mb-3">
                      {post.content}
                    </p>
                    
                    <div className="flex items-center justify-between text-sm text-text-secondary mb-3">
                      <span>{post.content.length} characters</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => regeneratePost(post.post_timing, post.platform)}
                          disabled={regenerating === key}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                          title="Regenerate"
                        >
                          {regenerating === key ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => copyToClipboard(post.content, key)}
                          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                          title="Copy"
                        >
                          {copiedPost === key ? 
                            <Check className="w-4 h-4 text-success" /> : 
                            <Copy className="w-4 h-4" />
                          }
                        </button>
                      </div>
                    </div>
                    
                    {/* Add feedback component */}
                    <ContentFeedback
                      content={post.content}
                      platform={post.platform}
                      generationType="campaign"
                      campaignId={campaign.id}
                      postId={post.id}
                      onRegenerate={() => regeneratePost(post.post_timing, post.platform)}
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
