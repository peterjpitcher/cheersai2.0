"use client";

import { Facebook, Instagram, Twitter, MapPin, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";

const platformInfo: { 
  [key: string]: { 
    icon: any; 
    label: string; 
    color: string;
    bgColor: string;
  } 
} = {
  facebook: { 
    icon: Facebook, 
    label: "Facebook", 
    color: "text-white",
    bgColor: "bg-blue-600"
  },
  instagram_business: { 
    icon: Instagram, 
    label: "Instagram", 
    color: "text-white",
    bgColor: "bg-gradient-to-br from-purple-600 to-pink-500"
  },
  instagram: { 
    icon: Instagram, 
    label: "Instagram", 
    color: "text-white",
    bgColor: "bg-gradient-to-br from-purple-600 to-pink-500"
  },
  twitter: { 
    icon: Twitter, 
    label: "X", 
    color: "text-white",
    bgColor: "bg-black"
  },
  x: { 
    icon: Twitter, 
    label: "X", 
    color: "text-white",
    bgColor: "bg-black"
  },
  google_my_business: { 
    icon: MapPin, 
    label: "Google Business", 
    color: "text-white",
    bgColor: "bg-green-600"
  },
  linkedin: { 
    icon: Linkedin, 
    label: "LinkedIn", 
    color: "text-white",
    bgColor: "bg-blue-700"
  },
};

interface PlatformBadgeProps {
  platform?: string | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export default function PlatformBadge({ 
  platform, 
  size = "md", 
  showLabel = true,
  className 
}: PlatformBadgeProps) {
  if (!platform) return null;
  
  const info = platformInfo[platform];
  if (!info) {
    // Fallback for unknown platforms
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-700",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        size === "lg" && "px-3 py-1.5 text-base",
        className
      )}>
        <span className="font-medium">{platform}</span>
      </div>
    );
  }

  const Icon = info.icon;
  const iconSize = size === "sm" ? "w-3 h-3" : size === "md" ? "w-4 h-4" : "w-5 h-5";

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-full",
      info.bgColor,
      info.color,
      size === "sm" && "px-2 py-0.5 text-xs",
      size === "md" && "px-2.5 py-1 text-sm",
      size === "lg" && "px-3 py-1.5 text-base",
      className
    )}>
      <Icon className={iconSize} />
      {showLabel && <span className="font-medium">{info.label}</span>}
    </div>
  );
}

export { platformInfo };