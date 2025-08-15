"use client";

import { useState } from "react";
import { Copy, Send, Check, Edit2 } from "lucide-react";
import PublishModal from "@/components/publish-modal";

interface PostActionsProps {
  post: {
    id: string;
    content: string;
    scheduled_for: string;
  };
  campaignName: string;
  imageUrl?: string;
}

export default function PostActions({ post, campaignName, imageUrl }: PostActionsProps) {
  const [copied, setCopied] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const copyPost = async () => {
    await navigator.clipboard.writeText(post.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="flex gap-1">
        <button
          onClick={copyPost}
          className="p-2 text-text-secondary hover:text-primary hover:bg-primary/10 rounded-soft transition-colors"
          title="Copy post"
        >
          {copied ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => setShowPublishModal(true)}
          className="p-2 text-text-secondary hover:text-primary hover:bg-primary/10 rounded-soft transition-colors"
          title="Publish to social media"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <PublishModal
        isOpen={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        post={post}
        campaignName={campaignName}
        imageUrl={imageUrl}
      />
    </>
  );
}