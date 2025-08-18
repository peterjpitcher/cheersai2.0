"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Calendar, Clock, ChevronLeft,
  PartyPopper, Sparkles, Sun, Megaphone
} from "lucide-react";
import { POST_TIMINGS } from "@/lib/openai/prompts";
import CampaignActions from "./campaign-actions";
import PostActions from "./post-actions";
import ContentFeedback from "@/components/feedback/content-feedback";

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
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
                  {isUpcoming && (
                    <span className="text-success">• {daysUntil} days until event</span>
                  )}
                </p>
              </div>
            </div>
            <CampaignActions 
              campaignId={campaign.id}
              campaignName={campaign.name}
              campaignStatus={campaign.status}
              posts={sortedPosts}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Campaign Info */}
          <div className="lg:col-span-1 space-y-4">
            {/* Hero Image */}
            {campaign.hero_image && (
              <div className="card p-4">
                <p className="text-sm font-medium text-text-secondary mb-2">Campaign Image</p>
                <div className="aspect-square rounded-medium overflow-hidden bg-gray-100">
                  <img
                    src={campaign.hero_image.file_url}
                    alt={campaign.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}

            {/* Event Details */}
            <div className="card">
              <h3 className="font-semibold mb-3">Event Details</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-text-secondary" />
                  <span>{eventDate.toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}</span>
                </div>
                {eventDate.getHours() !== 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-text-secondary" />
                    <span>{eventDate.toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="card">
              <h3 className="font-semibold mb-3">Campaign Status</h3>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  campaign.status === "active" ? "bg-success" : "bg-warning"
                }`} />
                <span className="capitalize">{campaign.status}</span>
              </div>
              <p className="text-sm text-text-secondary mt-2">
                {sortedPosts.length} posts generated
              </p>
            </div>
          </div>

          {/* Posts Timeline */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-heading font-bold mb-4">Campaign Posts</h2>
            
            {sortedPosts.length === 0 ? (
              <div className="card text-center py-8">
                <p className="text-text-secondary mb-4">No posts generated yet</p>
                <Link href={`/campaigns/${campaign.id}/generate`} className="btn-primary">
                  Generate Posts
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedPosts.map((post: any, index: number) => {
                  const timing = POST_TIMINGS.find(t => t.id === post.post_timing);
                  const scheduledDate = new Date(post.scheduled_for);
                  const isPast = scheduledDate < new Date();

                  return (
                    <div key={post.id} className="card">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold flex items-center gap-2">
                            <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
                              {index + 1}
                            </span>
                            {timing?.label}
                          </h4>
                          <p className="text-sm text-text-secondary mt-1">
                            {scheduledDate.toLocaleDateString("en-GB", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                            {scheduledDate.getHours() !== 0 && (
                              <> at {scheduledDate.toLocaleTimeString("en-GB", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}</>
                            )}
                            {isPast && (
                              <span className="ml-2 text-text-secondary/50">• Posted</span>
                            )}
                          </p>
                        </div>
                        <PostActions
                          post={post}
                          campaignName={campaign.name}
                          imageUrl={campaign.hero_image?.file_url}
                        />
                      </div>
                      <p className="whitespace-pre-wrap text-text-primary bg-background rounded-soft p-3 mb-3">
                        {post.content}
                      </p>
                      
                      {/* Add feedback component */}
                      <ContentFeedback
                        content={post.content}
                        platform={post.platform}
                        generationType="campaign"
                        campaignId={campaign.id}
                        postId={post.id}
                        onFeedbackSubmit={handleFeedbackSubmit}
                        className="mt-3"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}