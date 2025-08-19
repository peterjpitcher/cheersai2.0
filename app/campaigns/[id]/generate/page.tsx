"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import {
  Sparkles, Clock, Calendar, Edit2, RefreshCw,
  Copy, Download, Check, Loader2, ChevronRight,
  Facebook, Instagram, Twitter, MapPin, Linkedin,
  Send, Eye, ThumbsUp
} from "lucide-react";
import ContentFeedback from "@/components/feedback/content-feedback";

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
}

// Platform icons and labels
const platformInfo: { [key: string]: { icon: any; label: string; color: string } } = {
  facebook: { icon: Facebook, label: "Facebook", color: "bg-blue-600" },
  instagram_business: { icon: Instagram, label: "Instagram", color: "bg-gradient-to-br from-purple-600 to-pink-500" },
  twitter: { icon: Twitter, label: "X (Twitter)", color: "bg-black" },
  google_my_business: { icon: MapPin, label: "Google My Business", color: "bg-green-600" },
  linkedin: { icon: Linkedin, label: "LinkedIn", color: "bg-blue-700" },
};

export default function GenerateCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<CampaignPost[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [copiedPost, setCopiedPost] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"timeline" | "matrix">("timeline");
  const [approvalStatus, setApprovalStatus] = useState<{ [key: string]: "draft" | "approved" | "rejected" }>({});
  const [platforms, setPlatforms] = useState<string[]>([]);

  useEffect(() => {
    fetchCampaign();
  }, [campaignId]);

  const fetchCampaign = async () => {
    const supabase = createClient();
    
    const { data } = await supabase
      .from("campaigns")
      .select(`
        *,
        hero_image:media_assets (
          file_url
        )
      `)
      .eq("id", campaignId)
      .single();

    if (data) {
      setCampaign(data);
      
      // Check if posts already exist
      const { data: existingPosts } = await supabase
        .from("campaign_posts")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("scheduled_for");

      if (existingPosts && existingPosts.length > 0) {
        setPosts(existingPosts);
        // Extract unique platforms from existing posts
        const uniquePlatforms = [...new Set(existingPosts.map(p => p.platform).filter(Boolean))];
        setPlatforms(uniquePlatforms);
        // Set initial approval status
        const status: any = {};
        existingPosts.forEach(post => {
          const key = `${post.post_timing}-${post.platform}`;
          status[key] = post.status || "draft";
        });
        setApprovalStatus(status);
      } else {
        // Generate all posts
        generateAllPosts(data);
      }
    }
  };

  const generateAllPosts = async (campaign: Campaign) => {
    setGenerating(true);
    const eventDate = new Date(campaign.event_date);
    const generatedPosts: CampaignPost[] = [];

    // Get selected platforms from connected social accounts
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
      
    const { data: connections } = await supabase
      .from("social_connections")
      .select("platform")
      .eq("tenant_id", userData?.tenant_id)
      .eq("is_active", true);
      
    const connectedPlatforms = connections?.map(c => c.platform) || ['facebook'];
    setPlatforms(connectedPlatforms);
    
    // Use user's selected timings or fall back to defaults
    const selectedTimings = (campaign as any).selected_timings || ['week_before', 'day_before', 'day_of'];
    const customDates = (campaign as any).custom_dates || [];
    
    // Generate posts for selected timings only
    const timingsToGenerate = POST_TIMINGS.filter(timing => 
      selectedTimings.includes(timing.id)
    );

    // Generate platform-specific content for each timing
    for (const timing of timingsToGenerate) {
      // Calculate scheduled time
      const scheduledDate = new Date(eventDate);
      scheduledDate.setDate(scheduledDate.getDate() + timing.days);
      if (timing.hours) {
        scheduledDate.setHours(scheduledDate.getHours() + timing.hours);
      }
      
      // Generate content for each platform
      for (const platform of connectedPlatforms) {
        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaignId,
              postTiming: timing.id,
              campaignType: campaign.campaign_type,
              campaignName: campaign.name,
              eventDate: campaign.event_date,
              platform: platform,
            }),
          });

          if (response.ok) {
            const { content } = await response.json();
            
            generatedPosts.push({
              post_timing: timing.id,
              content,
              scheduled_for: scheduledDate.toISOString(),
              platform: platform,
              status: "draft",
            });
            
            // Set initial approval status
            setApprovalStatus(prev => ({
              ...prev,
              [`${timing.id}-${platform}`]: "draft"
            }));
          }
        } catch (error) {
          console.error(`Failed to generate ${platform} ${timing.id} post:`, error);
        }
      }
    }

    // Generate posts for custom dates with platform-specific content
    for (const customDate of customDates) {
      for (const platform of connectedPlatforms) {
        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaignId: campaign.id,
              postTiming: "custom",
              campaignType: campaign.campaign_type,
              campaignName: campaign.name,
              eventDate: campaign.event_date,
              customDate: customDate,
              platform: platform,
            }),
          });

          if (response.ok) {
            const { content } = await response.json();
            
            generatedPosts.push({
              post_timing: "custom",
              content,
              scheduled_for: customDate,
              platform: platform,
              status: "draft",
            });
          }
        } catch (error) {
          console.error(`Failed to generate custom ${platform} post:`, error);
        }
      }
    }

    setPosts(generatedPosts);
    setGenerating(false);
  };

  const regeneratePost = async (postTiming: string, platform?: string) => {
    if (!campaign) return;
    
    setGenerating(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          postTiming,
          campaignType: campaign.campaign_type,
          campaignName: campaign.name,
          eventDate: campaign.event_date,
          platform: platform || "facebook",
        }),
      });

      if (response.ok) {
        const { content } = await response.json();
        setPosts(posts.map(p => 
          (p.post_timing === postTiming && p.platform === platform) ? { ...p, content } : p
        ));
      }
    } catch (error) {
      console.error("Regeneration failed:", error);
    }
    setGenerating(false);
  };

  const updatePostContent = (postTiming: string, platform: string, content: string) => {
    setPosts(posts.map(p => 
      (p.post_timing === postTiming && p.platform === platform) ? { ...p, content } : p
    ));
  };

  const toggleApproval = (postTiming: string, platform: string) => {
    const key = `${postTiming}-${platform}`;
    const currentStatus = approvalStatus[key] || "draft";
    const newStatus = currentStatus === "draft" ? "approved" : 
                     currentStatus === "approved" ? "rejected" : "draft";
    
    setApprovalStatus(prev => ({
      ...prev,
      [key]: newStatus
    }));
    
    // Update post status
    setPosts(posts.map(p => 
      (p.post_timing === postTiming && p.platform === platform) 
        ? { ...p, status: newStatus } : p
    ));
  };

  const copyToClipboard = async (content: string, key: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedPost(key);
    setTimeout(() => setCopiedPost(null), 2000);
  };

  const saveCampaign = async () => {
    setSaving(true);
    const supabase = createClient();
    
    try {
      // Save all posts with their approval status
      for (const post of posts) {
        const key = `${post.post_timing}-${post.platform}`;
        const status = approvalStatus[key] || "draft";
        
        if (post.id) {
          // Update existing post
          await supabase
            .from("campaign_posts")
            .update({ 
              content: post.content,
              status: status
            })
            .eq("id", post.id);
        } else {
          // Create new post with platform and status
          await supabase
            .from("campaign_posts")
            .insert({
              campaign_id: campaignId,
              post_timing: post.post_timing,
              content: post.content,
              scheduled_for: post.scheduled_for,
              platform: post.platform || 'facebook',
              status: status,
            });
        }
      }

      // Update campaign status
      await supabase
        .from("campaigns")
        .update({ status: "active" })
        .eq("id", campaignId);

      router.push(`/campaigns/${campaignId}`);
    } catch (error) {
      console.error("Save failed:", error);
      alert("Failed to save campaign");
    }
    setSaving(false);
  };

  const downloadAllPosts = () => {
    const content = posts.map(post => {
      const timing = POST_TIMINGS.find(t => t.id === post.post_timing) || { label: "Custom" };
      const date = new Date(post.scheduled_for).toLocaleDateString("en-GB");
      const platform = platformInfo[post.platform || "facebook"]?.label || post.platform;
      return `${timing.label} - ${platform} (${date})\n${'-'.repeat(40)}\n${post.content}\n`;
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

  // Group posts by timing for matrix view
  const getPostsMatrix = () => {
    const matrix: { [timing: string]: { [platform: string]: CampaignPost } } = {};
    
    posts.forEach(post => {
      if (!matrix[post.post_timing]) {
        matrix[post.post_timing] = {};
      }
      if (post.platform) {
        matrix[post.post_timing][post.platform] = post;
      }
    });
    
    return matrix;
  };

  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const postsMatrix = getPostsMatrix();
  const uniqueTimings = Object.keys(postsMatrix);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">{campaign.name}</h1>
              <p className="text-sm text-text-secondary">
                AI-Generated Content Review
              </p>
            </div>
            <div className="flex gap-2">
              {/* View Mode Toggle - Desktop Only */}
              <div className="hidden md:flex border border-border rounded-lg">
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`px-3 py-1.5 text-sm ${viewMode === "timeline" ? "bg-primary text-white" : "text-text-secondary"} rounded-l-lg transition-colors`}
                >
                  Timeline
                </button>
                <button
                  onClick={() => setViewMode("matrix")}
                  className={`px-3 py-1.5 text-sm ${viewMode === "matrix" ? "bg-primary text-white" : "text-text-secondary"} rounded-r-lg transition-colors`}
                >
                  Matrix
                </button>
              </div>
              <button onClick={downloadAllPosts} className="btn-ghost">
                <Download className="w-4 h-4 mr-2" />
                Export
              </button>
              <button 
                onClick={saveCampaign}
                disabled={saving || generating}
                className="btn-primary"
              >
                {saving ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Save & Publish
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Hero Image - Smaller and to the side on desktop */}
        {campaign.hero_image && (
          <div className="mb-8 flex flex-col md:flex-row gap-6">
            <div className="md:w-1/3">
              <div className="card p-4">
                <p className="text-sm font-medium text-text-secondary mb-2">Campaign Visual</p>
                <div className="aspect-video rounded-medium overflow-hidden bg-gray-100">
                  <img
                    src={campaign.hero_image.file_url}
                    alt={campaign.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
            <div className="md:w-2/3">
              <div className="card p-6">
                <h2 className="font-semibold mb-2">Campaign Overview</h2>
                <p className="text-text-secondary mb-4">
                  Review and approve content for each platform. Click the status icons to approve or reject posts.
                </p>
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-gray-300"></div>
                    <span>Draft</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-success"></div>
                    <span>Approved</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-error"></div>
                    <span>Rejected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content Display */}
        {generating && posts.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="w-12 h-12 text-primary mx-auto mb-4 animate-pulse" />
            <p className="text-lg font-medium">Generating platform-optimized content...</p>
            <p className="text-sm text-text-secondary mt-2">Creating {platforms.length} versions for each timing</p>
          </div>
        ) : viewMode === "matrix" && typeof window !== 'undefined' && window.innerWidth >= 768 ? (
          // Matrix View - Desktop Only
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 font-medium">Timing</th>
                  {platforms.map(platform => {
                    const info = platformInfo[platform];
                    return (
                      <th key={platform} className="text-center p-4 font-medium">
                        <div className="flex items-center justify-center gap-2">
                          {info && <info.icon className="w-5 h-5" />}
                          <span>{info?.label || platform}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {uniqueTimings.map(timing => {
                  const timingInfo = POST_TIMINGS.find(t => t.id === timing) || { label: "Custom" };
                  const firstPost = Object.values(postsMatrix[timing])[0];
                  const scheduledDate = firstPost ? new Date(firstPost.scheduled_for) : new Date();
                  
                  return (
                    <tr key={timing} className="border-b border-border">
                      <td className="p-4 align-top">
                        <div className="font-medium">{timingInfo.label}</div>
                        <div className="text-sm text-text-secondary mt-1">
                          {scheduledDate.toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </div>
                      </td>
                      {platforms.map(platform => {
                        const post = postsMatrix[timing]?.[platform];
                        const key = `${timing}-${platform}`;
                        const status = approvalStatus[key] || "draft";
                        
                        if (!post) {
                          return <td key={platform} className="p-4 text-center text-text-secondary">-</td>;
                        }
                        
                        return (
                          <td key={platform} className="p-4 align-top">
                            <div className="card p-3">
                              {/* Approval Status */}
                              <div className="flex items-center justify-between mb-2">
                                <button
                                  onClick={() => toggleApproval(timing, platform)}
                                  className={`w-6 h-6 rounded-full transition-colors ${
                                    status === "approved" ? "bg-success" : 
                                    status === "rejected" ? "bg-error" : 
                                    "bg-gray-300"
                                  }`}
                                  title={`Status: ${status}`}
                                >
                                  {status === "approved" && <Check className="w-4 h-4 text-white mx-auto" />}
                                  {status === "rejected" && <X className="w-4 h-4 text-white mx-auto" />}
                                </button>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => regeneratePost(timing, platform)}
                                    className="p-1 hover:bg-gray-100 rounded"
                                    title="Regenerate"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => copyToClipboard(post.content, key)}
                                    className="p-1 hover:bg-gray-100 rounded"
                                    title="Copy"
                                  >
                                    {copiedPost === key ? 
                                      <Check className="w-3 h-3 text-success" /> : 
                                      <Copy className="w-3 h-3" />
                                    }
                                  </button>
                                </div>
                              </div>
                              {/* Content */}
                              <p className="text-sm line-clamp-4">{post.content}</p>
                              {/* Character count */}
                              <p className="text-xs text-text-secondary mt-2">
                                {post.content.length} characters
                              </p>
                              {/* Feedback Component */}
                              <ContentFeedback
                                content={post.content}
                                platform={platform}
                                generationType="campaign"
                                campaignId={campaignId}
                                onRegenerate={() => regeneratePost(timing, platform)}
                                className="mt-2"
                              />
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
          // Timeline View (Default for mobile, optional for desktop)
          <div className="space-y-6">
            {uniqueTimings.map((timing, timingIndex) => {
              const timingInfo = POST_TIMINGS.find(t => t.id === timing) || { label: "Custom" };
              const timingPosts = posts.filter(p => p.post_timing === timing);
              const firstPost = timingPosts[0];
              const scheduledDate = firstPost ? new Date(firstPost.scheduled_for) : new Date();
              
              return (
                <div key={timing} className="relative">
                  {/* Timeline connector */}
                  {timingIndex < uniqueTimings.length - 1 && (
                    <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-border hidden md:block" />
                  )}
                  
                  <div className="flex gap-4">
                    {/* Timeline dot */}
                    <div className="flex-shrink-0 w-12 h-12 bg-primary rounded-full items-center justify-center text-white font-bold hidden md:flex">
                      {timingIndex + 1}
                    </div>
                    
                    {/* Posts for this timing */}
                    <div className="flex-1">
                      {/* Timing Header */}
                      <div className="mb-4">
                        <h3 className="font-semibold text-lg">{timingInfo.label}</h3>
                        <p className="text-sm text-text-secondary flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {scheduledDate.toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                      
                      {/* Platform-specific posts */}
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {timingPosts.map(post => {
                          const platform = post.platform || "facebook";
                          const info = platformInfo[platform];
                          const key = `${timing}-${platform}`;
                          const status = approvalStatus[key] || "draft";
                          const isEditing = editingPost === key;
                          
                          return (
                            <div key={key} className="card">
                              {/* Platform Header */}
                              <div className="flex items-center justify-between p-4 border-b border-border">
                                <div className="flex items-center gap-2">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white ${info?.color || "bg-gray-600"}`}>
                                    {info && <info.icon className="w-5 h-5" />}
                                  </div>
                                  <span className="font-medium">{info?.label || platform}</span>
                                </div>
                                <button
                                  onClick={() => toggleApproval(timing, platform)}
                                  className={`w-8 h-8 rounded-full transition-colors flex items-center justify-center ${
                                    status === "approved" ? "bg-success" : 
                                    status === "rejected" ? "bg-error" : 
                                    "bg-gray-300"
                                  }`}
                                  title={`Click to ${status === "draft" ? "approve" : status === "approved" ? "reject" : "reset"}`}
                                >
                                  {status === "approved" && <Check className="w-5 h-5 text-white" />}
                                  {status === "rejected" && <X className="w-5 h-5 text-white" />}
                                  {status === "draft" && <Eye className="w-4 h-4 text-gray-600" />}
                                </button>
                              </div>
                              
                              {/* Content */}
                              <div className="p-4">
                                {isEditing ? (
                                  <textarea
                                    value={post.content}
                                    onChange={(e) => updatePostContent(timing, platform, e.target.value)}
                                    className="input-field min-h-[120px] font-body text-sm"
                                    autoFocus
                                  />
                                ) : (
                                  <p className="whitespace-pre-wrap text-sm">{post.content}</p>
                                )}
                                
                                {/* Character count */}
                                <p className="text-xs text-text-secondary mt-3">
                                  {post.content.length} characters
                                </p>
                                
                                {/* Actions */}
                                <div className="flex items-center justify-between mt-4">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setEditingPost(isEditing ? null : key)}
                                      className="text-text-secondary hover:text-primary transition-colors"
                                      title="Edit"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => regeneratePost(timing, platform)}
                                      disabled={generating}
                                      className="text-text-secondary hover:text-primary transition-colors"
                                      title="Regenerate"
                                    >
                                      <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
                                    </button>
                                    <button
                                      onClick={() => copyToClipboard(post.content, key)}
                                      className="text-text-secondary hover:text-primary transition-colors"
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
                                
                                {/* Feedback Component */}
                                <ContentFeedback
                                  content={post.content}
                                  platform={platform}
                                  generationType="campaign"
                                  campaignId={campaignId}
                                  onRegenerate={() => regeneratePost(timing, platform)}
                                  className="mt-4"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}