"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  Clock, CheckCircle, XCircle, RefreshCw, 
  AlertTriangle, Calendar, ChevronLeft, Loader2 
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface QueueItem {
  id: string;
  status: "pending" | "processing" | "published" | "failed" | "retry";
  scheduled_for: string;
  attempts: number;
  error_message?: string;
  last_attempt_at?: string;
  next_retry_at?: string;
  campaign_posts: {
    content: string;
    tenant_id: string;
  };
  social_connections: {
    platform: string;
    page_name?: string;
    account_name?: string;
  };
}

const STATUS_COLORS = {
  pending: "bg-gray-100 text-gray-700",
  processing: "bg-blue-100 text-blue-700",
  published: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  retry: "bg-yellow-100 text-yellow-700",
};

const STATUS_ICONS = {
  pending: Clock,
  processing: RefreshCw,
  published: CheckCircle,
  failed: XCircle,
  retry: AlertTriangle,
};

export default function PublishingQueuePage() {
  const router = useRouter();
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "failed" | "retry">("all");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchQueueItems();
    const interval = setInterval(fetchQueueItems, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchQueueItems = async () => {
    try {
      const supabase = createClient();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      // Get user's tenant
      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) return;

      // Fetch queue items
      const { data } = await supabase
        .from("publishing_queue")
        .select(`
          *,
          campaign_posts!inner (
            content,
            tenant_id
          ),
          social_connections (
            platform,
            page_name,
            account_name
          )
        `)
        .eq("campaign_posts.tenant_id", userData.tenant_id)
        .order("scheduled_for", { ascending: true });

      if (data) {
        setQueueItems(data);
      }
    } catch (error) {
      console.error("Error fetching queue items:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchQueueItems();
  };

  const handleRetryNow = async (itemId: string) => {
    const supabase = createClient();
    
    // Reset the item to pending and clear retry status
    const { error } = await supabase
      .from("publishing_queue")
      .update({
        status: "pending",
        scheduled_for: new Date().toISOString(),
        attempts: 0,
        error_message: null,
        next_retry_at: null
      })
      .eq("id", itemId);

    if (!error) {
      fetchQueueItems();
    }
  };

  const handleCancelItem = async (itemId: string) => {
    if (!confirm("Are you sure you want to cancel this post?")) return;
    
    const supabase = createClient();
    const { error } = await supabase
      .from("publishing_queue")
      .delete()
      .eq("id", itemId);

    if (!error) {
      fetchQueueItems();
    }
  };

  const filteredItems = queueItems.filter(item => {
    if (filter === "all") return true;
    if (filter === "failed") return item.status === "failed";
    if (filter === "retry") return item.status === "retry";
    if (filter === "pending") return ["pending", "processing"].includes(item.status);
    return true;
  });

  const stats = {
    pending: queueItems.filter(i => ["pending", "processing"].includes(i.status)).length,
    failed: queueItems.filter(i => i.status === "failed").length,
    retry: queueItems.filter(i => i.status === "retry").length,
    published: queueItems.filter(i => i.status === "published").length,
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
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Publishing Queue</h1>
                <p className="text-sm text-text-secondary">
                  Monitor and manage your scheduled posts
                </p>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-secondary"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Pending</p>
                <p className="text-2xl font-bold">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Retrying</p>
                <p className="text-2xl font-bold">{stats.retry}</p>
              </div>
              <RefreshCw className="w-8 h-8 text-yellow-500" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Failed</p>
                <p className="text-2xl font-bold">{stats.failed}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Published</p>
                <p className="text-2xl font-bold">{stats.published}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {["all", "pending", "retry", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-4 py-2 rounded-medium text-sm font-medium transition-colors ${
                filter === f
                  ? "bg-primary text-white"
                  : "bg-surface text-text-secondary hover:bg-gray-100"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== "all" && (
                <span className="ml-2">
                  ({f === "pending" ? stats.pending : f === "retry" ? stats.retry : stats.failed})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Queue Items */}
        <div className="space-y-4">
          {filteredItems.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-text-secondary">No items in queue</p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const StatusIcon = STATUS_ICONS[item.status];
              return (
                <div key={item.id} className="card">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-medium ${STATUS_COLORS[item.status]}`}>
                      <StatusIcon className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium">
                            {item.social_connections?.platform === "facebook" && "Facebook"}
                            {item.social_connections?.platform === "instagram" && "Instagram"}
                            {item.social_connections?.platform === "twitter" && "Twitter/X"}
                            {item.social_connections?.platform === "google_my_business" && "Google My Business"}
                            {" - "}
                            {item.social_connections?.page_name || item.social_connections?.account_name}
                          </p>
                          <p className="text-sm text-text-secondary mt-1">
                            {item.campaign_posts.content.substring(0, 100)}
                            {item.campaign_posts.content.length > 100 && "..."}
                          </p>
                        </div>
                        
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                          {item.status}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-text-secondary">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          Scheduled: {new Date(item.scheduled_for).toLocaleString("en-GB")}
                        </span>
                        
                        {item.attempts > 0 && (
                          <span>Attempts: {item.attempts}/5</span>
                        )}
                        
                        {item.next_retry_at && (
                          <span>
                            Next retry: {new Date(item.next_retry_at).toLocaleString("en-GB")}
                          </span>
                        )}
                      </div>
                      
                      {item.error_message && (
                        <div className="mt-2 p-2 bg-red-50 rounded-soft">
                          <p className="text-sm text-red-700">{item.error_message}</p>
                        </div>
                      )}
                      
                      {(item.status === "failed" || item.status === "retry") && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleRetryNow(item.id)}
                            className="btn-secondary text-sm py-1"
                          >
                            Retry Now
                          </button>
                          <button
                            onClick={() => handleCancelItem(item.id)}
                            className="text-red-600 hover:bg-red-50 px-3 py-1 rounded-soft text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}