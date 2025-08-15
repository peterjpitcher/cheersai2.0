"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Check, Trash2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface CampaignPost {
  id: string;
  post_timing: string;
  content: string;
  scheduled_for: string;
}

interface CampaignActionsProps {
  campaignId: string;
  campaignName: string;
  campaignStatus?: string;
  posts: CampaignPost[];
}

export default function CampaignActions({ campaignId, campaignName, campaignStatus = "draft", posts }: CampaignActionsProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const copyAllPosts = async () => {
    const content = posts.map(post => post.content).join("\n\n---\n\n");
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAllPosts = () => {
    const content = posts.map(post => {
      const date = new Date(post.scheduled_for).toLocaleDateString("en-GB");
      return `Post ${posts.indexOf(post) + 1} - ${date}\n${'-'.repeat(40)}\n${post.content}`;
    }).join('\n\n');

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaignName.replace(/\s+/g, "-")}-posts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deleteCampaign = async () => {
    if (!confirm(`Are you sure you want to delete the campaign "${campaignName}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    const supabase = createClient();

    try {
      // Delete campaign posts first
      const { error: postsError } = await supabase
        .from("campaign_posts")
        .delete()
        .eq("campaign_id", campaignId);

      if (postsError) throw postsError;

      // Delete the campaign
      const { error: campaignError } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaignId);

      if (campaignError) throw campaignError;

      // Redirect to campaigns list
      router.push("/campaigns");
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete campaign");
      setDeleting(false);
    }
  };

  return (
    <div className="flex gap-2">
      <button onClick={copyAllPosts} className="btn-ghost">
        {copied ? (
          <Check className="w-4 h-4 mr-2 text-success" />
        ) : (
          <Copy className="w-4 h-4 mr-2" />
        )}
        {copied ? "Copied!" : "Copy All"}
      </button>
      <button onClick={downloadAllPosts} className="btn-secondary">
        <Download className="w-4 h-4 mr-2" />
        Download
      </button>
      {campaignStatus === "draft" && (
        <button 
          onClick={deleteCampaign} 
          disabled={deleting}
          className="btn-ghost text-error hover:bg-error/10"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4 mr-2" />
          )}
          {deleting ? "Deleting..." : "Delete"}
        </button>
      )}
    </div>
  );
}