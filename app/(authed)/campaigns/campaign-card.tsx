"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { 
  Calendar, PartyPopper, Sparkles, Sun, Megaphone,
  Trash2, Loader2 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from 'sonner';
import { formatDate } from '@/lib/datetime';

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
    hero_image?: { file_url: string } | Array<{ file_url: string } | null> | null;
    campaign_posts?: { id: string }[];
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
      toast.error("Failed to delete campaign");
      setDeleting(false);
    }
  };

  // Normalise hero image shape (object or array)
  const heroObj = Array.isArray(campaign.hero_image)
    ? (campaign.hero_image.find(Boolean) as { file_url: string } | undefined)
    : (campaign.hero_image as { file_url: string } | undefined | null) || undefined;

  if (isDraft) {
    return (
      <div className="rounded-card border bg-card text-card-foreground shadow-card hover:shadow-cardHover cursor-pointer transition-shadow group relative">
        <Link href={`/campaigns/${campaign.id}/generate`} className="block">
          {/* Image */}
          <div className="relative aspect-square rounded-chip overflow-hidden bg-gray-100">
            {heroObj?.file_url ? (
              <img src={heroObj.file_url} alt={campaign.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <Icon className="w-8 h-8 text-primary/50" />
              </div>
            )}
            {/* Overlays */}
            <span className="absolute top-2 left-2 text-[10px] bg-white/90 text-gray-900 px-1.5 py-0.5 rounded">Draft</span>
            <span className={`absolute top-2 right-2 ${color} text-white px-1.5 py-0.5 rounded text-[10px] capitalize`}>{campaign.campaign_type}</span>
            <button
              onClick={handleDelete}
              title="Delete campaign"
              className="absolute bottom-2 right-2 bg-white/90 hover:bg-white text-red-600 rounded-md p-1"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
          {/* Content */}
          <div className="px-3 py-2">
            <h3 className="font-semibold text-sm leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{campaign.name}</h3>
            <p className="mt-1 text-xs text-text-secondary flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {formatDate(eventDate, undefined, { day: 'numeric', month: 'short' })}
              <span className="mx-1">•</span>
              Not generated
            </p>
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-card border bg-card text-card-foreground shadow-card hover:shadow-cardHover cursor-pointer transition-shadow group relative">
      <Link href={`/campaigns/${campaign.id}`} className="block">
        {/* Image */}
        <div className="relative aspect-square rounded-chip overflow-hidden bg-gray-100">
          {heroObj?.file_url ? (
            <img src={heroObj.file_url} alt={campaign.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
              <Icon className="w-8 h-8 text-primary/50" />
            </div>
          )}
          {/* Overlays */}
          <span className={`absolute top-2 right-2 ${color} text-white px-1.5 py-0.5 rounded text-[10px] capitalize`}>{campaign.campaign_type}</span>
          {isUpcoming && <span className="absolute top-2 left-2 text-[10px] bg-white/90 text-success px-1.5 py-0.5 rounded">Upcoming</span>}
          <button
            onClick={handleDelete}
            title="Delete campaign"
            className="absolute bottom-2 right-2 bg-white/90 hover:bg-white text-red-600 rounded-md p-1"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Content */}
        <div className="px-3 py-2">
          <h3 className="font-semibold text-sm leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{campaign.name}</h3>
          <p className="mt-1 text-xs text-text-secondary flex items-center gap-2">
            <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(eventDate, undefined, { day: 'numeric', month: 'short' })}</span>
            <span className="text-text-secondary">•</span>
            <span>{postCount} posts</span>
          </p>
        </div>
      </Link>
    </div>
  );
}
