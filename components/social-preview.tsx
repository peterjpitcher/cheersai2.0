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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Facebook Header */}
      <div className="p-3 flex items-center gap-3 border-b border-gray-100">
        <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
          P
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">Your Pub Name</p>
          <p className="text-xs text-gray-500">Just now · 🌍</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        <p 
          className="text-sm text-gray-900 whitespace-pre-wrap"
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
      <div className="p-3 border-t border-gray-100">
        <div className="flex justify-between text-gray-500 text-xs mb-3">
          <span>👍 0</span>
          <span>0 comments · 0 shares</span>
        </div>
        <div className="flex justify-around pt-2 border-t border-gray-100">
          <button className="flex-1 py-2 text-gray-600 text-sm font-medium hover:bg-gray-50 rounded">
            👍 Like
          </button>
          <button className="flex-1 py-2 text-gray-600 text-sm font-medium hover:bg-gray-50 rounded">
            💬 Comment
          </button>
          <button className="flex-1 py-2 text-gray-600 text-sm font-medium hover:bg-gray-50 rounded">
            ↗️ Share
          </button>
        </div>
      </div>
    </div>
  );

  const renderInstagramPreview = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Instagram Header */}
      <div className="p-3 flex items-center gap-3 border-b border-gray-100">
        <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
          P
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">yourpubname</p>
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
        <div className="relative aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
          <p className="text-gray-400 text-sm px-4 text-center">
            Instagram requires an image or video
          </p>
        </div>
      )}

      {/* Instagram Interactions */}
      <div className="p-3">
        <div className="flex gap-4 mb-3">
          <button>❤️</button>
          <button>💬</button>
          <button>📤</button>
          <button className="ml-auto">🔖</button>
        </div>
        
        <p className="text-sm font-semibold mb-1">0 likes</p>
        
        <p className="text-sm">
          <span className="font-semibold">yourpubname</span>{" "}
          <span 
            dangerouslySetInnerHTML={{ 
              __html: formatHashtags(truncateContent(content, 125)) 
            }}
          />
        </p>
        
        {content.length > 125 && (
          <button className="text-gray-500 text-sm">more</button>
        )}
        
        <p className="text-xs text-gray-500 mt-2">JUST NOW</p>
      </div>
    </div>
  );

  const renderGoogleMyBusinessPreview = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* GMB Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <p className="font-semibold">Your Pub Name</p>
            <p className="text-sm text-gray-500">Local business · Just now</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <p className="text-sm text-gray-900 whitespace-pre-wrap">
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
      <div className="p-4 border-t border-gray-100">
        <div className="flex gap-4">
          <button className="border border-input rounded-md px-3 py-1.5 text-sm">
            Learn more
          </button>
          <button className="text-sm text-text-secondary hover:bg-muted rounded-md px-3 py-1.5">
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
            className={`flex items-center gap-2 px-4 py-2 rounded-medium transition-colors ${
              activePlatform === "facebook"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Facebook className="w-4 h-4" />
            Facebook
          </button>
        )}
        {platforms.includes("instagram") && (
          <button
            onClick={() => setActivePlatform("instagram")}
            className={`flex items-center gap-2 px-4 py-2 rounded-medium transition-colors ${
              activePlatform === "instagram"
                ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Instagram className="w-4 h-4" />
            Instagram
          </button>
        )}
        {platforms.includes("google_my_business") && (
          <button
            onClick={() => setActivePlatform("google_my_business")}
            className={`flex items-center gap-2 px-4 py-2 rounded-medium transition-colors ${
              activePlatform === "google_my_business"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <MapPin className="w-4 h-4" />
            Google
          </button>
        )}
      </div>

      {/* Device Selector */}
      <div className="flex items-center gap-2">
        <Eye className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-500">Preview as:</span>
        <button
          onClick={() => setActiveDevice("mobile")}
          className={`p-2 rounded ${
            activeDevice === "mobile" ? "bg-primary/10 text-primary" : "text-gray-400"
          }`}
        >
          <Smartphone className="w-4 h-4" />
        </button>
        <button
          onClick={() => setActiveDevice("desktop")}
          className={`p-2 rounded ${
            activeDevice === "desktop" ? "bg-primary/10 text-primary" : "text-gray-400"
          }`}
        >
          <Monitor className="w-4 h-4" />
        </button>
      </div>

      {/* Preview Container */}
      <div className={`${
        activeDevice === "mobile" 
          ? "max-w-sm mx-auto" 
          : "max-w-2xl"
      }`}>
        {getPlatformPreview()}
      </div>

      {/* Platform Tips */}
      <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
        <p className="text-sm font-medium text-primary mb-1">
          {activePlatform === "facebook" && "Facebook Post Tips"}
          {activePlatform === "instagram" && "Instagram Post Tips"}
          {activePlatform === "google_my_business" && "Google My Business Tips"}
        </p>
        <ul className="text-xs text-text-secondary space-y-1">
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
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="sticky top-0 bg-white border-b p-4">
          <DialogTitle className="text-xl font-heading">Social Media Preview</DialogTitle>
        </DialogHeader>
        <div className="p-6">
          <SocialPreview content={content} imageUrl={imageUrl} platforms={platforms} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
