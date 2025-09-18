"use client";

import { useState } from "react";
import { Facebook, Instagram, MapPin, Smartphone, Monitor, Eye } from "lucide-react";
import Image from "next/image";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SocialPreviewProps {
  content: string;
  imageUrl?: string;
  platforms?: string[];
}

export function SocialPreview({ content, imageUrl, platforms = ["facebook", "instagram"] }: SocialPreviewProps) {
  const [activeDevice, setActiveDevice] = useState<"mobile" | "desktop">("mobile");
  const [activePlatform, setActivePlatform] = useState(platforms[0]);

  const truncateContent = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const formatHashtags = (text: string) => {
    return text.replace(/#(\w+)/g, '<span class="text-blue-600">#$1</span>');
  };

  const renderFacebookPreview = () => (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Facebook Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 p-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary font-bold text-white">
          P
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Your Pub Name</p>
          <p className="text-xs text-gray-500">Just now · 🌍</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        <p 
          className="whitespace-pre-wrap text-sm text-gray-900"
          dangerouslySetInnerHTML={{ __html: formatHashtags(truncateContent(content, 500)) }}
        />
      </div>

      {/* Image */}
      {imageUrl && (
        <div className="relative aspect-video bg-gray-100">
          <Image
            src={imageUrl}
            alt="Post image"
            fill
            className="object-cover"
          />
        </div>
      )}

      {/* Facebook Interactions */}
      <div className="border-t border-gray-100 p-3">
        <div className="mb-3 flex justify-between text-xs text-gray-500">
          <span>👍 0</span>
          <span>0 comments · 0 shares</span>
        </div>
        <div className="flex justify-around border-t border-gray-100 pt-2">
          <button className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            👍 Like
          </button>
          <button className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            💬 Comment
          </button>
          <button className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            ↗️ Share
          </button>
        </div>
      </div>
    </div>
  );

  const renderInstagramPreview = () => (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Instagram Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 p-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-pink-500 text-sm font-bold text-white">
          P
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">yourpubname</p>
        </div>
        <button className="text-gray-600">⋯</button>
      </div>

      {/* Image */}
      {imageUrl ? (
        <div className="relative aspect-square bg-gray-100">
          <Image
            src={imageUrl}
            alt="Post image"
            fill
            className="object-cover"
          />
        </div>
      ) : (
        <div className="relative flex aspect-square items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
          <p className="px-4 text-center text-sm text-gray-400">
            Instagram requires an image or video
          </p>
        </div>
      )}

      {/* Instagram Interactions */}
      <div className="p-3">
        <div className="mb-3 flex gap-4">
          <button>❤️</button>
          <button>💬</button>
          <button>📤</button>
          <button className="ml-auto">🔖</button>
        </div>
        
        <p className="mb-1 text-sm font-semibold">0 likes</p>
        
        <p className="text-sm">
          <span className="font-semibold">yourpubname</span>{" "}
          <span 
            dangerouslySetInnerHTML={{ 
              __html: formatHashtags(truncateContent(content, 125)) 
            }}
          />
        </p>
        
        {content.length > 125 && (
          <button className="text-sm text-gray-500">more</button>
        )}
        
        <p className="mt-2 text-xs text-gray-500">JUST NOW</p>
      </div>
    </div>
  );

  const renderGoogleMyBusinessPreview = () => (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* GMB Header */}
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-green-600 text-white">
            <MapPin className="size-6" />
          </div>
          <div>
            <p className="font-semibold">Your Pub Name</p>
            <p className="text-sm text-gray-500">Local business · Just now</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="whitespace-pre-wrap text-sm text-gray-900">
          {truncateContent(content, 1500)}
        </p>
      </div>

      {/* Image */}
      {imageUrl && (
        <div className="relative aspect-video bg-gray-100">
          <Image
            src={imageUrl}
            alt="Post image"
            fill
            className="object-cover"
          />
        </div>
      )}

      {/* GMB Actions */}
      <div className="border-t border-gray-100 p-4">
        <div className="flex gap-4">
          <button className="rounded-md border border-input px-3 py-1.5 text-sm">
            Learn more
          </button>
          <button className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-muted">
            Call now
          </button>
        </div>
      </div>
    </div>
  );

  const getPlatformPreview = () => {
    switch (activePlatform) {
      case "facebook":
        return renderFacebookPreview();
      case "instagram":
        return renderInstagramPreview();
      case "google_my_business":
        return renderGoogleMyBusinessPreview();
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Platform Selector */}
      <div className="flex gap-2">
        {platforms.includes("facebook") && (
          <button
            onClick={() => setActivePlatform("facebook")}
            className={`flex items-center gap-2 rounded-medium px-4 py-2 transition-colors ${
              activePlatform === "facebook"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Facebook className="size-4" />
            Facebook
          </button>
        )}
        {platforms.includes("instagram") && (
          <button
            onClick={() => setActivePlatform("instagram")}
            className={`flex items-center gap-2 rounded-medium px-4 py-2 transition-colors ${
              activePlatform === "instagram"
                ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Instagram className="size-4" />
            Instagram
          </button>
        )}
        {platforms.includes("google_my_business") && (
          <button
            onClick={() => setActivePlatform("google_my_business")}
            className={`flex items-center gap-2 rounded-medium px-4 py-2 transition-colors ${
              activePlatform === "google_my_business"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <MapPin className="size-4" />
            Google
          </button>
        )}
      </div>

      {/* Device Selector */}
      <div className="flex items-center gap-2">
        <Eye className="size-4 text-gray-400" />
        <span className="text-sm text-gray-500">Preview as:</span>
        <button
          onClick={() => setActiveDevice("mobile")}
          className={`rounded p-2 ${
            activeDevice === "mobile" ? "bg-primary/10 text-primary" : "text-gray-400"
          }`}
        >
          <Smartphone className="size-4" />
        </button>
        <button
          onClick={() => setActiveDevice("desktop")}
          className={`rounded p-2 ${
            activeDevice === "desktop" ? "bg-primary/10 text-primary" : "text-gray-400"
          }`}
        >
          <Monitor className="size-4" />
        </button>
      </div>

      {/* Preview Container */}
      <div className={`${
        activeDevice === "mobile" 
          ? "mx-auto max-w-sm" 
          : "max-w-2xl"
      }`}>
        {getPlatformPreview()}
      </div>

      {/* Platform Tips */}
      <div className="rounded-medium border border-primary/20 bg-primary/5 p-4">
        <p className="mb-1 text-sm font-medium text-primary">
          {activePlatform === "facebook" && "Facebook Post Tips"}
          {activePlatform === "instagram" && "Instagram Post Tips"}
          {activePlatform === "google_my_business" && "Google Business Profile Tips"}
        </p>
        <ul className="space-y-1 text-xs text-text-secondary">
          {activePlatform === "facebook" && (
            <>
              <li>• Optimal length: 40-80 characters for high engagement</li>
              <li>• Posts with images get 2.3x more engagement</li>
              <li>• Best posting times: 1-3pm weekdays</li>
            </>
          )}
          {activePlatform === "instagram" && (
            <>
              <li>• Use up to 30 hashtags for maximum reach</li>
              <li>• Square images (1:1) perform best</li>
              <li>• Caption limit: 2,200 characters</li>
              <li>• Best times: 11am-1pm and 5-6pm</li>
            </>
          )}
          {activePlatform === "google_my_business" && (
            <>
              <li>• Posts appear in Google Search and Maps</li>
              <li>• Include a call-to-action button</li>
              <li>• Posts expire after 7 days</li>
              <li>• Maximum 1,500 characters</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

// Standalone preview modal component
export function SocialPreviewModal({ 
  isOpen, 
  onClose, 
  content, 
  imageUrl,
  platforms 
}: SocialPreviewProps & { 
  isOpen: boolean; 
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o)=>{ if(!o) onClose(); }}>
      <DialogContent className="max-w-4xl overflow-hidden p-0">
        <DialogHeader className="sticky top-0 border-b bg-white p-4">
          <DialogTitle className="font-heading text-xl">Social Media Preview</DialogTitle>
        </DialogHeader>
        <div className="p-6">
          <SocialPreview content={content} imageUrl={imageUrl} platforms={platforms} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
