"use client";

import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { 
  Calendar, PartyPopper, Sparkles, Sun, Megaphone,
  Trash2, Loader2 
} from "lucide-react";
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
  const eventDate = campaign.event_date ? new Date(campaign.event_date) : new Date();
  const isUpcoming = eventDate > new Date();
  const postCount = campaign.campaign_posts?.length || 0;
  const isDraft = campaign.status === "draft";

  const handleDelete = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm(`Are you sure you want to delete "${campaign.name}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data && (data.error || data.message)) || "Failed to delete campaign");
      }

      // Refresh the page
      router.refresh();
    } catch (error) {
      console.error("Delete error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete campaign");
      setDeleting(false);
    }
  };

  // Normalise hero image shape (object or array)
  const heroObj = Array.isArray(campaign.hero_image)
    ? (campaign.hero_image.find(Boolean) as { file_url: string } | undefined)
    : (campaign.hero_image as { file_url: string } | undefined | null) || undefined;

  if (isDraft) {
    return (
      <div className="group relative cursor-pointer rounded-card border bg-card text-card-foreground shadow-card transition-shadow hover:shadow-cardHover">
        <Link href={`/campaigns/${campaign.id}/generate`} className="block">
          {/* Image */}
          <div className="relative aspect-square overflow-hidden rounded-chip bg-gray-100">
            {heroObj?.file_url ? (
              <Image
                src={heroObj.file_url}
                alt={campaign.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 33vw"
                priority={false}
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <Icon className="size-8 text-primary/50" />
              </div>
            )}
            {/* Overlays */}
            <span className="absolute left-2 top-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-900">Draft</span>
            <span className={`absolute right-2 top-2 ${color} rounded px-1.5 py-0.5 text-[10px] capitalize text-white`}>{campaign.campaign_type}</span>
            <button
              onClick={handleDelete}
              title="Delete campaign"
              className="absolute bottom-2 right-2 rounded-md bg-white/90 p-1 text-red-600 hover:bg-white"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </button>
          </div>
          {/* Content */}
          <div className="px-3 py-2">
            <h3 className="text-sm font-semibold leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{campaign.name}</h3>
            <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
              <Calendar className="size-3" /> {formatDate(eventDate, undefined, { day: 'numeric', month: 'short' })}
              <span className="mx-1">•</span>
              Not generated
            </p>
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div className="group relative cursor-pointer rounded-card border bg-card text-card-foreground shadow-card transition-shadow hover:shadow-cardHover">
      <Link href={`/campaigns/${campaign.id}`} className="block">
        {/* Image */}
        <div className="relative aspect-square overflow-hidden rounded-chip bg-gray-100">
          {heroObj?.file_url ? (
            <Image
              src={heroObj.file_url}
              alt={campaign.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 33vw"
              priority={false}
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
              <Icon className="size-8 text-primary/50" />
            </div>
          )}
          {/* Overlays */}
          <span className={`absolute right-2 top-2 ${color} rounded px-1.5 py-0.5 text-[10px] capitalize text-white`}>{campaign.campaign_type}</span>
          {isUpcoming && <span className="absolute left-2 top-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-success">Upcoming</span>}
          <button
            onClick={handleDelete}
            title="Delete campaign"
            className="absolute bottom-2 right-2 rounded-md bg-white/90 p-1 text-red-600 hover:bg-white"
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </div>

        {/* Content */}
        <div className="px-3 py-2">
          <h3 className="text-sm font-semibold leading-snug" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{campaign.name}</h3>
          <p className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1"><Calendar className="size-3" /> {formatDate(eventDate, undefined, { day: 'numeric', month: 'short' })}</span>
            <span className="text-text-secondary">•</span>
            <span>{postCount} posts</span>
          </p>
        </div>
      </Link>
    </div>
  );
}
