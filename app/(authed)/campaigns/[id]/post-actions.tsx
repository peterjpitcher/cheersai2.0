"use client";

import { useState } from "react";
import { Copy, Send, Check } from "lucide-react";
import PublishModal from "@/components/publish-modal";

interface PostActionsProps {
  post: {
    id: string;
    content: string;
    scheduled_for: string | null;
    approval_status?: string | null;
    platform?: string | null;
    platforms?: string[] | null;
  };
  campaignName: string;
  imageUrl?: string;
  compact?: boolean;
  campaignId: string;
}

export default function PostActions({ post, campaignName, imageUrl, compact, campaignId }: PostActionsProps) {
  const [copied, setCopied] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const copyPost = async () => {
    await navigator.clipboard.writeText(post.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buttonClass = compact 
    ? "p-1 text-text-secondary hover:text-primary hover:bg-primary/10 rounded transition-colors"
    : "p-2 text-text-secondary hover:text-primary hover:bg-primary/10 rounded-soft transition-colors";
  
  const iconClass = compact ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <>
      <div className="flex gap-1">
        {!compact && (
          <button
            onClick={copyPost}
            className={buttonClass}
            title="Copy post"
          >
            {copied ? (
              <Check className={`${iconClass} text-success`} />
            ) : (
              <Copy className={iconClass} />
            )}
          </button>
        )}
        <button
          onClick={() => setShowPublishModal(true)}
          className={buttonClass}
          title="Publish to social media"
        >
          <Send className={iconClass} />
        </button>
      </div>

      <PublishModal
        isOpen={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        post={post}
        campaignName={campaignName}
        imageUrl={imageUrl}
        campaignId={campaignId}
      />
    </>
  );
}
