"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Facebook,
  Instagram,
  MapPin,
  Calendar,
  Send,
  Loader2,
  ExternalLink,
} from "lucide-react";
import Container from "@/components/layout/container";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import PostHistoryDrawer from "@/components/publishing/PostHistoryDrawer";

interface PublishingRecord {
  id: string;
  campaign_post_id: string;
  platform: string;
  status: "pending" | "published" | "failed";
  published_at?: string;
  platform_post_id?: string;
  error_message?: string;
  campaign_posts: {
    content: string;
    post_timing: string;
  };
  social_connections: {
    page_name: string;
    account_name: string;
    platform?: string;
  };
}

interface QueueItem {
  id: string;
  scheduled_for: string;
  status: string;
  attempts: number;
  campaign_posts: {
    content: string;
  };
  social_connections: {
    platform: string;
    page_name: string;
  };
}

export default function PublishingStatusPage() {
  const params = useParams();
  const campaignId = params.id as string;
  
  const [history, setHistory] = useState<PublishingRecord[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"history" | "queue">("history");
  const [campaignName, setCampaignName] = useState("");
  const [historyPostId, setHistoryPostId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Get campaign details
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("name")
      .eq("id", campaignId)
      .single();

    if (campaign) {
      setCampaignName(campaign.name);
    }

    // Get publishing history
    const { data: historyData } = await supabase
      .from("publishing_history")
      .select(`
        *,
        campaign_posts!inner (
          content,
          post_timing,
          campaign_id
        ),
        social_connections (
          page_name,
          account_name,
          platform
        )
      `)
      .eq("campaign_posts.campaign_id", campaignId)
      .order("created_at", { ascending: false });

    if (historyData) {
      setHistory(historyData);
    }

    // Get queue items
    const { data: queueData } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts!inner (
          content,
          campaign_id
        ),
        social_connections (
          platform,
          page_name
        )
      `)
      .eq("campaign_posts.campaign_id", campaignId)
      .order("scheduled_for", { ascending: true });

    if (queueData) {
      setQueue(queueData);
    }

    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    void fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      void fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRebuildQueue = useCallback(async () => {
    setRebuilding(true);
    try {
      await fetch("/api/queue/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      await fetchData();
    } finally {
      setRebuilding(false);
    }
  }, [campaignId, fetchData]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="size-5 text-success" />;
      case "published":
        return <CheckCircle className="size-5 text-success" />;
      case "failed":
        return <XCircle className="size-5 text-error" />;
      case "pending":
        return <Clock className="size-5 text-warning" />;
      case "processing":
        return <RefreshCw className="size-5 animate-spin text-primary" />;
      default:
        return <AlertCircle className="size-5 text-text-secondary" />;
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "facebook":
        return <Facebook className="size-5 text-blue-600" />;
      case "instagram":
        return <Instagram className="size-5 text-purple-600" />;
      case "google_my_business":
        return <MapPin className="size-5 text-green-600" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      published: "bg-success/10 text-success",
      failed: "bg-error/10 text-error",
      pending: "bg-warning/10 text-warning",
      processing: "bg-primary/10 text-primary"
    };

    return (
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${styles[status as keyof typeof styles] || "bg-gray-100 text-gray-600"}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const formatDate = (date: string) =>
    formatDateTime(date, undefined, { day: "2-digit", month: "short", year: "numeric" });

  const retryPublication = async (queueId: string) => {
    const supabase = createClient();

    // Reset the queue item for retry
    await supabase
      .from("publishing_queue")
      .update({
        status: "pending",
        scheduled_for: new Date().toISOString(),
        last_error: null,
        next_attempt_at: null
      })
      .eq("id", queueId);

    await fetchData();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="pb-page-pb pt-page-pt">
        <div className="mb-4 flex items-center justify-between">
          <div className="truncate text-sm text-text-secondary">{campaignName}</div>
          <button
            onClick={() => {
              void fetchData();
            }}
            className="rounded-md px-3 py-2 text-text-secondary hover:bg-muted"
            title="Refresh"
          >
            <RefreshCw className="size-5" />
          </button>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <div />
          <div className="flex items-center gap-2">
            <button
              disabled={rebuilding}
              onClick={() => {
                void handleRebuildQueue();
              }}
              className="rounded-md border border-input px-3 py-1.5 text-sm"
              title="Insert any missing queue rows and sync times to match posts"
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild Queue'}
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="mb-6 flex gap-4 border-b border-border">
          <button
            onClick={() => setActiveTab("history")}
            className={`relative px-1 pb-3 font-medium transition-colors ${
              activeTab === "history"
                ? "text-primary"
                : "text-text-secondary hover:text-primary"
            }`}
          >
            Publishing History
            {history.length > 0 && (
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-1 text-xs">
                {history.length}
              </span>
            )}
            {activeTab === "history" && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={`relative px-1 pb-3 font-medium transition-colors ${
              activeTab === "queue"
                ? "text-primary"
                : "text-text-secondary hover:text-primary"
            }`}
          >
            Scheduled Queue
            {queue.length > 0 && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                {queue.length}
              </span>
            )}
            {activeTab === "queue" && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>

        {/* Content */}
        {activeTab === "history" ? (
          <div className="space-y-4">
            {history.length === 0 ? (
              <div className="py-12 text-center">
                <Send className="mx-auto mb-4 size-12 text-gray-300" />
                <p className="text-text-secondary">No posts have been published yet</p>
              </div>
            ) : (
              history.map((record) => (
                <Card key={record.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      {getStatusIcon(record.status)}
                    </div>
                    <div className="flex-1">
                          <div className="mb-2 flex items-start justify-between">
                        <div>
                          <div className="mb-1 flex items-center gap-2">
                            {getPlatformIcon(record.social_connections?.platform || "")}
                            <span className="font-medium">
                              {record.social_connections?.page_name || "Unknown Page"}
                            </span>
                            {getStatusBadge(record.status)}
                          </div>
                          <p className="mb-2 text-sm text-text-secondary">
                            {record.campaign_posts.content.substring(0, 150)}...
                          </p>
                          <div className="flex items-center gap-4 text-xs text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Calendar className="size-3" />
                              {record.published_at ? formatDate(record.published_at) : "Not published"}
                            </span>
                            {record.campaign_posts.post_timing && (
                              <span className="capitalize">
                                {record.campaign_posts.post_timing.replace("_", " ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-muted"
                            title="View post history"
                            onClick={() => setHistoryPostId(record.campaign_post_id)}
                          >
                            History
                          </button>
                        {record.platform_post_id && (
                          <a
                            className="rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-muted"
                            title="View on platform"
                            href={record.platform_post_id}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                        </div>
                      </div>
                        {record.error_message && (
                          <div className="mt-2 rounded-card bg-error/10 p-2 text-sm text-error">
                            {record.error_message}
                          </div>
                        )}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {queue.length === 0 ? (
              <div className="py-12 text-center">
                <Clock className="mx-auto mb-4 size-12 text-gray-300" />
                <p className="text-text-secondary">No posts scheduled</p>
              </div>
            ) : (
              queue.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">
                      {getStatusIcon(item.status)}
                    </div>
                    <div className="flex-1">
                      <div className="mb-2 flex items-start justify-between">
                        <div>
                          <div className="mb-1 flex items-center gap-2">
                            {getPlatformIcon(item.social_connections?.platform || "")}
                            <span className="font-medium">
                              {item.social_connections?.page_name || "Unknown Page"}
                            </span>
                            {getStatusBadge(item.status)}
                          </div>
                          <p className="mb-2 text-sm text-text-secondary">
                            {item.campaign_posts.content.substring(0, 150)}...
                          </p>
                          <div className="flex items-center gap-4 text-xs text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              Scheduled for {formatDate(item.scheduled_for)}
                            </span>
                            {item.attempts > 0 && (
                              <span className="text-warning">
                                Attempt {item.attempts}/3
                              </span>
                            )}
                          </div>
                        </div>
                        {item.status === "failed" && (
                          <button
                            onClick={() => retryPublication(item.id)}
                            className="rounded-md border border-input px-2 py-1 text-sm"
                          >
                            <RefreshCw className="mr-2 size-4" />
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Stats Summary */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-6 text-center">
            <p className="text-2xl font-bold text-success">
              {history.filter(h => h.status === "published").length}
            </p>
            <p className="text-sm text-text-secondary">Published</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-2xl font-bold text-warning">
              {queue.filter(q => q.status === "pending").length}
            </p>
            <p className="text-sm text-text-secondary">Scheduled</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-2xl font-bold text-primary">
              {queue.filter(q => q.status === "processing").length}
            </p>
            <p className="text-sm text-text-secondary">Processing</p>
          </Card>
          <Card className="p-6 text-center">
            <p className="text-2xl font-bold text-error">
              {history.filter(h => h.status === "failed").length}
            </p>
            <p className="text-sm text-text-secondary">Failed</p>
          </Card>
        </div>
        </Container>
      </main>
      <HistoryDrawerMount postId={historyPostId} onClose={() => setHistoryPostId(null)} />
    </div>
  );
}

interface HistoryDrawerProps {
  postId: string | null;
  onClose: () => void;
}

// Drawer mount
// placed at end to avoid layout shift
function HistoryDrawerMount({ postId, onClose }: HistoryDrawerProps) {
  if (!postId) return null;
  return <PostHistoryDrawer postId={postId} open={Boolean(postId)} onClose={onClose} />;
}
