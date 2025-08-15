"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { 
  Calendar, PartyPopper, Sparkles, Sun, Megaphone,
  ChevronRight, Trash2, Loader2 
} from "lucide-react";

const CAMPAIGN_ICONS = {
  event: PartyPopper,
  special: Sparkles,
  seasonal: Sun,
  announcement: Megaphone,
};

const CAMPAIGN_COLORS = {
  event: "bg-purple-500",
  special: "bg-green-500",
  seasonal: "bg-orange-500",
  announcement: "bg-blue-500",
};

interface CampaignCardProps {
  campaign: {
    id: string;
    name: string;
    campaign_type: string;
    event_date: string;
    status: string;
    hero_image?: {
      file_url: string;
    };
    campaign_posts?: {
      id: string;
    }[];
  };
}

export default function CampaignCard({ campaign }: CampaignCardProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  
  const Icon = CAMPAIGN_ICONS[campaign.campaign_type as keyof typeof CAMPAIGN_ICONS] || Calendar;
  const color = CAMPAIGN_COLORS[campaign.campaign_type as keyof typeof CAMPAIGN_COLORS] || "bg-gray-500";
  const eventDate = new Date(campaign.event_date);
  const isUpcoming = eventDate > new Date();
  const postCount = campaign.campaign_posts?.length || 0;
  const isDraft = campaign.status === "draft";

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm(`Are you sure you want to delete "${campaign.name}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    const supabase = createClient();

    try {
      // Delete campaign posts first
      const { error: postsError } = await supabase
        .from("campaign_posts")
        .delete()
        .eq("campaign_id", campaign.id);

      if (postsError) throw postsError;

      // Delete the campaign
      const { error: campaignError } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaign.id);

      if (campaignError) throw campaignError;

      // Refresh the page
      router.refresh();
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete campaign");
      setDeleting(false);
    }
  };

  if (isDraft) {
    return (
      <div className="card-interactive group opacity-75 relative">
        <Link href={`/campaigns/${campaign.id}/generate`} className="block">
          <div className="flex items-center gap-3">
            <div className={`${color} p-2 rounded-medium text-white opacity-50`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">{campaign.name}</h3>
              <p className="text-sm text-text-secondary">Not generated yet</p>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn-ghost text-error hover:bg-error/10 p-2"
              title="Delete campaign"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
            <ChevronRight className="w-5 h-5 text-text-secondary" />
          </div>
        </Link>
      </div>
    );
  }

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="card-interactive group"
    >
      {/* Image or Icon */}
      {campaign.hero_image ? (
        <div className="aspect-video rounded-medium overflow-hidden mb-4 bg-gray-100">
          <img
            src={campaign.hero_image.file_url}
            alt={campaign.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        </div>
      ) : (
        <div className="aspect-video rounded-medium mb-4 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
          <Icon className="w-12 h-12 text-primary/50" />
        </div>
      )}

      {/* Content */}
      <div className="flex items-start gap-3">
        <div className={`${color} p-2 rounded-medium text-white flex-shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-1">{campaign.name}</h3>
          <p className="text-sm text-text-secondary mb-2">
            {eventDate.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
            {isUpcoming && (
              <span className="ml-2 text-success">• Upcoming</span>
            )}
          </p>
          <p className="text-sm text-text-secondary">
            {postCount} posts created
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-text-secondary group-hover:text-primary transition-colors" />
      </div>
    </Link>
  );
}