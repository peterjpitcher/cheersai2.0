"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw,
  Facebook, Instagram, MapPin, Calendar, Eye, Send,
  ChevronLeft, Loader2, ExternalLink
} from "lucide-react";
import Link from "next/link";
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
  const router = useRouter();
  const campaignId = params.id as string;
  
  const [history, setHistory] = useState<PublishingRecord[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"history" | "queue">("history");
  const [campaignName, setCampaignName] = useState("");
  const [historyPostId, setHistoryPostId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [campaignId]);

  const fetchData = async () => {
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
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-5 h-5 text-success" />;
      case "published":
        return <CheckCircle className="w-5 h-5 text-success" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-error" />;
      case "pending":
        return <Clock className="w-5 h-5 text-warning" />;
      case "processing":
        return <RefreshCw className="w-5 h-5 text-primary animate-spin" />;
      default:
        return <AlertCircle className="w-5 h-5 text-text-secondary" />;
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "facebook":
        return <Facebook className="w-5 h-5 text-blue-600" />;
      case "instagram":
        return <Instagram className="w-5 h-5 text-purple-600" />;
      case "google_my_business":
        return <MapPin className="w-5 h-5 text-green-600" />;
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
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || "bg-gray-100 text-gray-600"}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const formatDate = (date: string) => formatDateTime(date, undefined, { day: '2-digit', month: 'short', year: 'numeric' });

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

    fetchData();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={`/campaigns/${campaignId}`}
                className="text-text-secondary hover:text-primary"
              >
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Publishing Status</h1>
                <p className="text-sm text-text-secondary">{campaignName}</p>
              </div>
            </div>
            <button
              onClick={fetchData}
              className="text-text-secondary hover:bg-muted rounded-md px-3 py-2"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-8">
        <div className="flex items-center justify-between mb-4">
          <div />
          <div className="flex items-center gap-2">
            <button
              disabled={rebuilding}
              onClick={async () => {
                setRebuilding(true)
                try {
                  await fetch('/api/queue/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId }) })
                  await fetchData()
                } finally {
                  setRebuilding(false)
                }
              }}
              className="border border-input rounded-md px-3 py-1.5 text-sm"
              title="Insert any missing queue rows and sync times to match posts"
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild Queue'}
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-border">
          <button
            onClick={() => setActiveTab("history")}
            className={`pb-3 px-1 font-medium transition-colors relative ${
              activeTab === "history"
                ? "text-primary"
                : "text-text-secondary hover:text-primary"
            }`}
          >
            Publishing History
            {history.length > 0 && (
              <span className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded-full">
                {history.length}
              </span>
            )}
            {activeTab === "history" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={`pb-3 px-1 font-medium transition-colors relative ${
              activeTab === "queue"
                ? "text-primary"
                : "text-text-secondary hover:text-primary"
            }`}
          >
            Scheduled Queue
            {queue.length > 0 && (
              <span className="ml-2 text-xs bg-primary/10 px-2 py-1 rounded-full text-primary">
                {queue.length}
              </span>
            )}
            {activeTab === "queue" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>

        {/* Content */}
        {activeTab === "history" ? (
          <div className="space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-12">
                <Send className="w-12 h-12 text-gray-300 mx-auto mb-4" />
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
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {getPlatformIcon(record.social_connections?.platform || "")}
                            <span className="font-medium">
                              {record.social_connections?.page_name || "Unknown Page"}
                            </span>
                            {getStatusBadge(record.status)}
                          </div>
                          <p className="text-sm text-text-secondary mb-2">
                            {record.campaign_posts.content.substring(0, 150)}...
                          </p>
                          <div className="flex items-center gap-4 text-xs text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
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
                            className="text-sm text-text-secondary hover:bg-muted rounded-md px-2 py-1"
                            title="View post history"
                            onClick={() => setHistoryPostId(record.campaign_post_id)}
                          >
                            History
                          </button>
                        {record.platform_post_id && (
                          <button
                            className="text-sm text-text-secondary hover:bg-muted rounded-md px-2 py-1"
                            title="View on platform"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        )}
                        </div>
                      </div>
                      {record.error_message && (
                        <div className="mt-2 p-2 bg-error/10 rounded-soft text-sm text-error">
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
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
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
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            {getPlatformIcon(item.social_connections?.platform || "")}
                            <span className="font-medium">
                              {item.social_connections?.page_name || "Unknown Page"}
                            </span>
                            {getStatusBadge(item.status)}
                          </div>
                          <p className="text-sm text-text-secondary mb-2">
                            {item.campaign_posts.content.substring(0, 150)}...
                          </p>
                          <div className="flex items-center gap-4 text-xs text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
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
                            className="border border-input rounded-md px-2 py-1 text-sm"
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
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
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="text-center p-6">
            <p className="text-2xl font-bold text-success">
              {history.filter(h => h.status === "published").length}
            </p>
            <p className="text-sm text-text-secondary">Published</p>
          </Card>
          <Card className="text-center p-6">
            <p className="text-2xl font-bold text-warning">
              {queue.filter(q => q.status === "pending").length}
            </p>
            <p className="text-sm text-text-secondary">Scheduled</p>
          </Card>
          <Card className="text-center p-6">
            <p className="text-2xl font-bold text-primary">
              {queue.filter(q => q.status === "processing").length}
            </p>
            <p className="text-sm text-text-secondary">Processing</p>
          </Card>
          <Card className="text-center p-6">
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

// Drawer mount
// placed at end to avoid layout shift
// eslint-disable-next-line @next/next/no-img-element
// @ts-ignore
function HistoryDrawerMount({ postId, onClose }: { postId: string|null; onClose: () => void }) {
  if (!postId) return null
  return <PostHistoryDrawer postId={postId} open={!!postId} onClose={onClose} />
}
