"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import {
  Sparkles, Clock, Calendar, Edit2, RefreshCw,
  Copy, Download, Check, Loader2, ChevronRight
} from "lucide-react";
import Link from "next/link";

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
}

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

    // Get selected platforms from user's brand profile or use defaults
    const platforms = ['twitter', 'facebook', 'instagram']; // TODO: Load from profile
    
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
      for (const platform of platforms) {
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
              platform: platform, // Send single platform
            }),
          });

          if (response.ok) {
            const { content } = await response.json();
            
            generatedPosts.push({
              post_timing: timing.id,
              content,
              scheduled_for: scheduledDate.toISOString(),
              platform: platform, // Store platform
            });
          }
        } catch (error) {
          console.error(`Failed to generate ${platform} ${timing.id} post:`, error);
        }
      }
    }

    // Generate posts for custom dates
    for (const customDate of customDates) {
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
          }),
        });

        if (response.ok) {
          const { content } = await response.json();
          
          generatedPosts.push({
            post_timing: "custom",
            content,
            scheduled_for: customDate,
          });
        }
      } catch (error) {
        console.error(`Failed to generate custom date post:`, error);
      }
    }

    setPosts(generatedPosts);
    setGenerating(false);
  };

  const regeneratePost = async (postTiming: string) => {
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
        }),
      });

      if (response.ok) {
        const { content } = await response.json();
        setPosts(posts.map(p => 
          p.post_timing === postTiming ? { ...p, content } : p
        ));
      }
    } catch (error) {
      console.error("Regeneration failed:", error);
    }
    setGenerating(false);
  };

  const updatePostContent = (postTiming: string, content: string) => {
    setPosts(posts.map(p => 
      p.post_timing === postTiming ? { ...p, content } : p
    ));
  };

  const copyToClipboard = async (content: string, postTiming: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedPost(postTiming);
    setTimeout(() => setCopiedPost(null), 2000);
  };

  const saveCampaign = async () => {
    setSaving(true);
    const supabase = createClient();
    
    try {
      // Save all posts
      for (const post of posts) {
        if (post.id) {
          // Update existing post
          await supabase
            .from("campaign_posts")
            .update({ content: post.content })
            .eq("id", post.id);
        } else {
          // Create new post with platform
          await supabase
            .from("campaign_posts")
            .insert({
              campaign_id: campaignId,
              post_timing: post.post_timing,
              content: post.content,
              scheduled_for: post.scheduled_for,
              platform: (post as any).platform || 'twitter', // Include platform
              status: 'draft', // Set initial status
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
      const timing = POST_TIMINGS.find(t => t.id === post.post_timing);
      const date = new Date(post.scheduled_for).toLocaleDateString("en-GB");
      return `${timing?.label} (${date})\n${'-'.repeat(40)}\n${post.content}\n`;
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

  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">{campaign.name}</h1>
              <p className="text-sm text-text-secondary">
                AI-Generated Posts Timeline
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={downloadAllPosts} className="btn-ghost">
                <Download className="w-4 h-4 mr-2" />
                Download All
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
                    Save & Continue
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Hero Image Preview */}
        {campaign.hero_image && (
          <div className="mb-8 card p-4">
            <p className="text-sm font-medium text-text-secondary mb-2">Campaign Image</p>
            <div className="aspect-video rounded-medium overflow-hidden bg-gray-100">
              <img
                src={campaign.hero_image.file_url}
                alt={campaign.name}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Posts Timeline */}
        <div className="space-y-6">
          {generating && posts.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="w-12 h-12 text-primary mx-auto mb-4 animate-pulse" />
              <p className="text-lg font-medium">Generating your campaign posts...</p>
              <p className="text-sm text-text-secondary mt-2">This may take a few moments</p>
            </div>
          ) : (
            posts.map((post, index) => {
              const timing = POST_TIMINGS.find(t => t.id === post.post_timing);
              const scheduledDate = new Date(post.scheduled_for);
              const isEditing = editingPost === post.post_timing;

              return (
                <div key={post.post_timing} className="relative">
                  {/* Timeline connector */}
                  {index < posts.length - 1 && (
                    <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-border" />
                  )}

                  <div className="flex gap-4">
                    {/* Timeline dot */}
                    <div className="flex-shrink-0 w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white font-bold">
                      {index + 1}
                    </div>

                    {/* Post Card */}
                    <div className="flex-1 card">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-lg">{timing?.label}</h3>
                          <p className="text-sm text-text-secondary flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            {scheduledDate.toLocaleDateString("en-GB", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                            {scheduledDate.getHours() !== 0 && (
                              <>
                                <Clock className="w-4 h-4" />
                                {scheduledDate.toLocaleTimeString("en-GB", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </>
                            )}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingPost(isEditing ? null : post.post_timing)}
                            className="text-text-secondary hover:text-primary transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => regeneratePost(post.post_timing)}
                            disabled={generating}
                            className="text-text-secondary hover:text-primary transition-colors"
                            title="Regenerate"
                          >
                            <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
                          </button>
                          <button
                            onClick={() => copyToClipboard(post.content, post.post_timing)}
                            className="text-text-secondary hover:text-primary transition-colors"
                            title="Copy"
                          >
                            {copiedPost === post.post_timing ? (
                              <Check className="w-4 h-4 text-success" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <textarea
                          value={post.content}
                          onChange={(e) => updatePostContent(post.post_timing, e.target.value)}
                          className="input-field min-h-[120px] font-body"
                          autoFocus
                        />
                      ) : (
                        <p className="whitespace-pre-wrap text-text-primary">{post.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}