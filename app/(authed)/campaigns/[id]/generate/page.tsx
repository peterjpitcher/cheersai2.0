"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import {
  Sparkles, Clock, Calendar, Edit2, RefreshCw,
  Copy, Download, Check, Loader2, ChevronRight,
  Facebook, Instagram, Twitter, MapPin,
  Send, Eye, ThumbsUp, X, AlertCircle, Link2, Image as ImageIcon
} from "lucide-react";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
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
  media_url?: string | null;
}

// Platform icons and labels
const platformInfo: { [key: string]: { icon: any; label: string; color: string } } = {
  facebook: { icon: Facebook, label: "Facebook", color: "bg-blue-600" },
  instagram_business: { icon: Instagram, label: "Instagram", color: "bg-gradient-to-br from-purple-600 to-pink-500" },
  twitter: { icon: Twitter, label: "X (Twitter)", color: "bg-black" },
  google_my_business: { icon: MapPin, label: "Google My Business", color: "bg-green-600" },
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
  // Matrix view removed; always timeline
  const [approvalStatus, setApprovalStatus] = useState<{ [key: string]: "draft" | "approved" | "rejected" }>({});
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, currentPlatform: "", currentTiming: "" });
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedPostKeyForImage, setSelectedPostKeyForImage] = useState<string | null>(null);

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
      
      // Get current user's connected platforms
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userData } = await supabase
          .from("users")
          .select("tenant_id")
          .eq("id", user.id)
          .single();
          
        // Fetch from both social_connections and social_accounts tables
        const [legacyConnections, socialAccounts] = await Promise.all([
          supabase
            .from("social_connections")
            .select("platform")
            .eq("tenant_id", userData?.tenant_id)
            .eq("is_active", true),
          supabase
            .from("social_accounts")
            .select("platform")
            .eq("tenant_id", userData?.tenant_id)
            .eq("is_active", true)
        ]);
        
        // Combine platforms from both sources
        const allPlatforms = [];
        if (legacyConnections?.data) {
          allPlatforms.push(...legacyConnections.data.map(c => c.platform));
        }
        if (socialAccounts?.data) {
          allPlatforms.push(...socialAccounts.data.map(c => c.platform));
        }
        
        // Remove duplicates and normalize instagram_business to instagram
        const connectedPlatforms = [...new Set(allPlatforms)].map(platform => 
          platform === 'instagram' ? 'instagram_business' : platform
        );
        
        setPlatforms(connectedPlatforms);
        
        // Check if posts already exist
        const { data: existingPosts } = await supabase
          .from("campaign_posts")
          .select("*")
          .eq("campaign_id", campaignId)
          .order("scheduled_for");

        if (existingPosts && existingPosts.length > 0) {
          setPosts(existingPosts);
          // Set initial approval status
          const status: any = {};
          existingPosts.forEach(post => {
            const key = `${post.post_timing}-${post.platform}`;
            status[key] = post.status || "draft";
          });
          setApprovalStatus(status);
        } else {
          // Generate all posts if platforms are connected
          if (connectedPlatforms.length > 0) {
            generateAllPosts(data);
          }
        }
      }
    }
    setLoadingInitial(false);
  };

  const generateAllPosts = async (campaign: Campaign) => {
    setGenerating(true);
    const eventDate = new Date(campaign.event_date);
    const generatedPosts: CampaignPost[] = [];
    
    // Initialize progress tracking
    setGenerationProgress({ current: 0, total: 0, currentPlatform: "", currentTiming: "" });
    
    // Check if event date is in the past (allow existing campaigns but warn user)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDateOnly = new Date(eventDate);
    eventDateOnly.setHours(0, 0, 0, 0);
    
    if (eventDateOnly < today) {
      const proceed = confirm("Warning: This campaign's event date is in the past. Posts will still be generated but may not be relevant. Do you want to continue?");
      if (!proceed) {
        setGenerating(false);
        return;
      }
    }

    // Get selected platforms from connected social accounts
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
      
    // Fetch from both social_connections and social_accounts tables
    const [legacyConnections, socialAccounts] = await Promise.all([
      supabase
        .from("social_connections")
        .select("platform")
        .eq("tenant_id", userData?.tenant_id)
        .eq("is_active", true),
      supabase
        .from("social_accounts")
        .select("platform")
        .eq("tenant_id", userData?.tenant_id)
        .eq("is_active", true)
    ]);
    
    // Combine platforms from both sources
    const allPlatforms = [];
    if (legacyConnections?.data) {
      allPlatforms.push(...legacyConnections.data.map(c => c.platform));
    }
    if (socialAccounts?.data) {
      allPlatforms.push(...socialAccounts.data.map(c => c.platform));
    }
    
    // Remove duplicates and normalize instagram_business to instagram
    const connectedPlatforms = [...new Set(allPlatforms)].map(platform => 
      platform === 'instagram' ? 'instagram_business' : platform
    );
    
    // If no platforms are connected, stop generation and show message
    if (connectedPlatforms.length === 0) {
      setPlatforms([]);
      setGenerating(false);
      return;
    }
    setPlatforms(connectedPlatforms);
    
    // Use user's selected timings or fall back to defaults
    const selectedTimings = (campaign as any).selected_timings || ['week_before', 'day_before', 'day_of'];
    const customDates = (campaign as any).custom_dates || [];
    
    // Generate posts for selected timings only
    const timingsToGenerate = POST_TIMINGS.filter(timing => 
      selectedTimings.includes(timing.id)
    );

    // Calculate total posts to generate
    const totalPostsToGenerate = (timingsToGenerate.length + customDates.length) * connectedPlatforms.length;
    setGenerationProgress(prev => ({ ...prev, total: totalPostsToGenerate }));
    
    let currentProgress = 0;

    // Generate platform-specific content for each timing
    for (const timing of timingsToGenerate) {
      // Calculate scheduled time
      const scheduledDate = new Date(eventDate);
      scheduledDate.setDate(scheduledDate.getDate() + timing.days);
      if ('hours' in timing && timing.hours) {
        scheduledDate.setHours(scheduledDate.getHours() + timing.hours);
      }
      
      // Skip if scheduled time is in the past (more than 1 hour ago to allow for immediate posts)
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      if (scheduledDate < oneHourAgo) {
        console.log(`Skipping ${timing.id} - scheduled time is in the past:`, scheduledDate);
        continue;
      }
      
      // Generate content for each platform
      for (const platform of connectedPlatforms) {
        // Update progress
        currentProgress++;
        setGenerationProgress({ 
          current: currentProgress, 
          total: totalPostsToGenerate, 
          currentPlatform: platformInfo[platform]?.label || platform,
          currentTiming: timing.label
        });
        
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
              media_url: campaign.hero_image?.file_url || null,
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
      // Skip if custom date is in the past (more than 1 hour ago)
      const customDateTime = new Date(customDate);
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      if (customDateTime < oneHourAgo) {
        console.log(`Skipping custom date - scheduled time is in the past:`, customDateTime);
        continue;
      }
      
      for (const platform of connectedPlatforms) {
        // Update progress for custom dates
        currentProgress++;
        setGenerationProgress({ 
          current: currentProgress, 
          total: totalPostsToGenerate, 
          currentPlatform: platformInfo[platform]?.label || platform,
          currentTiming: "Custom Date"
        });
        
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
              media_url: campaign.hero_image?.file_url || null,
            });
          }
        } catch (error) {
          console.error(`Failed to generate custom ${platform} post:`, error);
        }
      }
    }

    setPosts(generatedPosts);
    setGenerating(false);
    setGenerationProgress({ current: 0, total: 0, currentPlatform: "", currentTiming: "" });
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
        const status = approvalStatus[key] || "draft";
        
        if (post.id) {
          // Update existing post
          await supabase
            .from("campaign_posts")
            .update({ 
              content: post.content,
              status: status,
              approval_status: status,
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
              content: post.content,
              scheduled_for: post.scheduled_for,
              platform: post.platform || 'facebook',
              status: status,
              approval_status: 'pending',
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

  // Unique timings present in current posts (sorted by POST_TIMINGS order, then custom at end)
  const timingOrder = (id: string) => {
    const idx = POST_TIMINGS.findIndex(t => t.id === id);
    return idx === -1 ? 999 : idx;
  };
  const uniqueTimings = Array.from(new Set(posts.map(p => p.post_timing))).sort((a, b) => timingOrder(a) - timingOrder(b));

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
        {/* Overview removed per product update; focus on per-post review */}

        {/* No Platforms Connected Message */}
        {platforms.length === 0 && !generating ? (
          <div className="text-center py-12">
            <div className="bg-amber-50 border border-amber-200 rounded-medium p-8 max-w-md mx-auto">
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
                  className="btn-primary inline-flex items-center"
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  Connect Social Accounts
                </a>
                <p className="text-xs text-amber-600">
                  Supported platforms: Facebook, Instagram, Twitter/X, Google My Business
                </p>
              </div>
            </div>
          </div>
        ) : generating && posts.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto space-y-6">
              {/* Animated logo */}
              <div className="relative">
                <Sparkles className="w-16 h-16 text-primary mx-auto animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              </div>
              
              {/* Progress information */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-semibold">Generating Content</h3>
                  <p className="text-text-secondary mt-1">
                    Creating platform-optimised posts using AI
                  </p>
                </div>
                
                {/* Progress bar */}
                {generationProgress.total > 0 && (
                  <div className="space-y-3">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ 
                          width: `${(generationProgress.current / generationProgress.total) * 100}%` 
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">
                        {generationProgress.current} of {generationProgress.total} posts
                      </span>
                      <span className="font-medium">
                        {Math.round((generationProgress.current / generationProgress.total) * 100)}%
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Current generation info */}
                {generationProgress.currentPlatform && (
                  <div className="bg-surface rounded-medium p-4">
                    <p className="text-sm font-medium">Currently generating:</p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                      <span className="text-sm text-text-secondary">
                        {generationProgress.currentTiming} • {generationProgress.currentPlatform}
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Platform count info */}
                <div className="flex justify-center gap-4 text-sm text-text-secondary">
                  <span>{platforms.length} platform{platforms.length !== 1 ? 's' : ''}</span>
                  <span>•</span>
                  <span>AI-powered content</span>
                </div>
              </div>
            </div>
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
                        <div className="flex items-center gap-3 mb-2">
                          {/* Mobile timeline indicator */}
                          <div className="flex-shrink-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-bold md:hidden">
                            {timingIndex + 1}
                          </div>
                          <h3 className="font-semibold text-lg">{timingInfo.label}</h3>
                        </div>
                        <p className="text-sm text-text-secondary flex items-center gap-2 md:ml-0 ml-11">
                          <Calendar className="w-4 h-4" />
                          {scheduledDate.toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                      
                      {/* Platform-specific posts */}
                      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                        {timingPosts.map((post) => {
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
                                <div className="flex items-center gap-2">
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
                          <div className="p-4">
                                {/* Image block above content to avoid narrow text columns */}
                                <div className="mb-4">
                                  <div className="aspect-square w-full rounded-medium overflow-hidden bg-gray-100 border border-border">
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
                                      className="mt-2 text-xs btn-ghost"
                                    >
                                      Replace Image
                                    </button>
                                  </div>
                                </div>
                                <div>
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
                                </div>
                                </div>
                                
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
                              
                              {/* Feedback Component - Dedicated Section */}
                              <div className="border-t border-border bg-gray-50/30 px-4 py-3">
                                <ContentFeedback
                                  content={post.content}
                                  platform={platform}
                                  generationType="campaign"
                                  campaignId={campaignId}
                                  onRegenerate={() => regeneratePost(timing, platform)}
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
