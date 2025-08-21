"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  X, Loader2, Facebook, Instagram, MapPin,
  Calendar, Clock, Send, AlertCircle, Check
} from "lucide-react";

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string;
  is_active: boolean;
}

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: {
    id: string;
    content: string;
    scheduled_for: string;
    approval_status?: string;
  };
  campaignName: string;
  imageUrl?: string;
}

const PLATFORM_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  google_my_business: MapPin,
};

const PLATFORM_COLORS = {
  facebook: "text-blue-600",
  instagram: "text-pink-600",
  google_my_business: "text-green-600",
};

export default function PublishModal({
  isOpen,
  onClose,
  post,
  campaignName,
  imageUrl,
}: PublishModalProps) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [publishTime, setPublishTime] = useState<"now" | "scheduled">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedConnections, setPublishedConnections] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchConnections();
      // Set default scheduled date/time to post's scheduled time
      const postDate = new Date(post.scheduled_for);
      setScheduledDate(postDate.toISOString().split("T")[0]);
      setScheduledTime(postDate.toTimeString().slice(0, 5));
    }
  }, [isOpen, post.scheduled_for]);

  const fetchConnections = async () => {
    setLoading(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Get active social connections
    const { data } = await supabase
      .from("social_connections")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .eq("is_active", true);

    if (data) {
      setConnections(data);
    }

    // Check publishing history for this post
    const { data: history } = await supabase
      .from("publishing_history")
      .select("social_connection_id")
      .eq("campaign_post_id", post.id)
      .eq("status", "published");

    if (history) {
      setPublishedConnections(history.map(h => h.social_connection_id));
    }

    setLoading(false);
  };

  const toggleConnection = (connectionId: string) => {
    setSelectedConnections(prev =>
      prev.includes(connectionId)
        ? prev.filter(id => id !== connectionId)
        : [...prev, connectionId]
    );
  };

  const handlePublish = async () => {
    if (selectedConnections.length === 0) {
      alert("Please select at least one social account");
      return;
    }

    // Check if post is approved
    if (post.approval_status !== 'approved') {
      alert("This post must be approved before it can be published");
      return;
    }

    setPublishing(true);

    try {
      let scheduleFor = undefined;
      
      if (publishTime === "scheduled") {
        scheduleFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
      }

      const response = await fetch("/api/social/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          content: post.content,
          connectionIds: selectedConnections,
          imageUrl,
          scheduleFor,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Show success message
        const successCount = data.results.filter((r: any) => r.success).length;
        const failCount = data.results.filter((r: any) => !r.success).length;
        
        let message = `Successfully ${publishTime === "scheduled" ? "scheduled" : "published"} to ${successCount} account(s)`;
        if (failCount > 0) {
          message += ` (${failCount} failed)`;
        }
        
        alert(message);
        onClose();
      } else {
        alert(data.error || "Failed to publish");
      }
    } catch (error) {
      console.error("Publishing error:", error);
      alert("Failed to publish. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-large max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-heading font-bold">Publish Post</h2>
              <p className="text-sm text-text-secondary mt-1">{campaignName}</p>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Post Preview */}
          <div className="mb-6">
            <h3 className="font-semibold mb-2">Post Content</h3>
            
            {/* Approval Status Warning */}
            {post.approval_status !== 'approved' && (
              <div className="bg-warning/10 border border-warning/20 rounded-medium p-4 mb-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Approval Required</p>
                    <p className="text-sm text-text-secondary mt-1">
                      This post must be approved before it can be published. 
                      {post.approval_status === 'rejected' ? ' It has been rejected and needs review.' : ' It is currently pending approval.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="bg-background rounded-medium p-4">
              <p className="text-sm whitespace-pre-wrap">{post.content}</p>
              {imageUrl && (
                <div className="mt-3">
                  <img
                    src={imageUrl}
                    alt="Post image"
                    className="w-32 h-32 object-cover rounded-soft"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Publishing Time */}
          <div className="mb-6">
            <h3 className="font-semibold mb-3">When to Publish</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="publishTime"
                  value="now"
                  checked={publishTime === "now"}
                  onChange={() => setPublishTime("now")}
                  className="w-4 h-4 text-primary"
                />
                <span>Publish immediately</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="publishTime"
                  value="scheduled"
                  checked={publishTime === "scheduled"}
                  onChange={() => setPublishTime("scheduled")}
                  className="w-4 h-4 text-primary"
                />
                <span>Schedule for later</span>
              </label>
              {publishTime === "scheduled" && (
                <div className="ml-7 flex gap-2">
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="px-3 py-2 border border-border rounded-soft"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="px-3 py-2 border border-border rounded-soft"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Social Accounts */}
          <div>
            <h3 className="font-semibold mb-3">Select Social Accounts</h3>
            
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : connections.length === 0 ? (
              <div className="bg-warning/10 border border-warning/20 rounded-medium p-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">No Connected Accounts</p>
                    <p className="text-sm text-text-secondary mt-1">
                      Connect your social media accounts in Settings to start publishing.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {connections.map((connection) => {
                  const Icon = PLATFORM_ICONS[connection.platform as keyof typeof PLATFORM_ICONS];
                  const isPublished = publishedConnections.includes(connection.id);
                  const isSelected = selectedConnections.includes(connection.id);

                  return (
                    <label
                      key={connection.id}
                      className={`flex items-center gap-3 p-3 border rounded-medium cursor-pointer transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      } ${isPublished ? "opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleConnection(connection.id)}
                        className="w-4 h-4 text-primary"
                      />
                      <Icon className={`w-5 h-5 ${PLATFORM_COLORS[connection.platform as keyof typeof PLATFORM_COLORS]}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {connection.page_name || connection.account_name}
                        </p>
                        <p className="text-xs text-text-secondary capitalize">
                          {connection.platform.replace("_", " ")}
                        </p>
                      </div>
                      {isPublished && (
                        <div className="flex items-center gap-1 text-success text-xs">
                          <Check className="w-3 h-3" />
                          Published
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border">
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="btn-secondary"
              disabled={publishing}
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              className="btn-primary flex items-center"
              disabled={publishing || selectedConnections.length === 0 || post.approval_status !== 'approved'}
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              {publishTime === "scheduled" ? "Schedule" : "Publish Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}