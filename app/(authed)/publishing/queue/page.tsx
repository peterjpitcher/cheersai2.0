"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  Clock, CheckCircle, XCircle, RefreshCw, 
  AlertTriangle, Calendar, ChevronLeft, Loader2,
  List, CalendarDays, Grid3X3 
} from "lucide-react";
import Link from "next/link";
import Container from "@/components/layout/container";
import EmptyState from "@/components/ui/empty-state";
import { TERMS } from "@/lib/copy";
import { formatTime, formatDateTime, getUserTimeZone } from "@/lib/datetime";
import { useRouter, useSearchParams } from "next/navigation";
import FullCalendar from "@/components/calendar/FullCalendar";
import { sortByDate } from "@/lib/sortByDate";

interface QueueItem {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  scheduled_for: string;
  attempts: number;
  last_error?: string;
  last_attempt_at?: string;
  next_attempt_at?: string;
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
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

const STATUS_ICONS = {
  pending: Clock,
  processing: RefreshCw,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: AlertTriangle,
};

// Week View Component
interface WeekViewProps {
  items: QueueItem[];
  onRetryNow: (itemId: string) => void;
  onCancelItem: (itemId: string) => void;
}

function WeekView({ items, onRetryNow, onCancelItem }: WeekViewProps) {
  // Get current week's start (Monday) and create 7 days
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    return date;
  });

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Group items by day
  const itemsByDay = weekDays.map(day => {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return {
      date: day,
      items: items.filter(item => {
        const scheduledDate = new Date(item.scheduled_for);
        return scheduledDate >= dayStart && scheduledDate <= dayEnd;
      })
    };
  });

  if (items.length === 0) {
    return (
      <EmptyState
        title="No items in queue"
        body="Scheduled items will appear here when ready."
        primaryCta={{ label: 'Open Calendar', href: '/publishing/queue?view=calendar' }}
        secondaryCta={{ label: 'Create Campaign', href: '/campaigns/new', variant: 'outline' }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
      {itemsByDay.map((day, index) => (
        <div key={day.date.toISOString()} className="rounded-lg border bg-card text-card-foreground shadow-sm p-4 min-h-[200px]">
          <div className="border-b border-border pb-3 mb-3">
            <h3 className="font-medium text-sm">{dayNames[index]}</h3>
            <p className="text-xs text-text-secondary">{formatDate(day.date, undefined, { day: 'numeric', month: 'short' })}</p>
          </div>
          
          <div className="space-y-2">
            {day.items.sort(sortByDate).map((item) => {
              const StatusIcon = STATUS_ICONS[item.status];
              return (
                <div key={item.id} className="border border-border rounded-soft p-2 bg-surface">
                  <div className="flex items-start gap-2">
                    <div className={`p-1 rounded-soft ${STATUS_COLORS[item.status]} flex-shrink-0`}>
                      <StatusIcon className="w-3 h-3" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {item.social_connections?.platform === "facebook" && "FB"}
                        {item.social_connections?.platform === "instagram" && "IG"}
                        {item.social_connections?.platform === "twitter" && "X"}
                        {item.social_connections?.platform === "google_my_business" && "GBP"}
                      </p>
                      <p className="text-xs text-text-secondary mt-1 truncate">
                        {item.campaign_posts.content.substring(0, 60)}
                        {item.campaign_posts.content.length > 60 && "..."}
                      </p>
                      <p className="text-xs text-text-secondary mt-1">{formatTime(item.scheduled_for, getUserTimeZone())}</p>
                      
                      {item.last_error && (
                        <div className="mt-1 p-1 bg-red-50 rounded-soft">
                          <p className="text-xs text-red-700 truncate" title={item.last_error}>
                            {item.last_error}
                          </p>
                        </div>
                      )}
                      
                      {item.status === "failed" && (
                        <div className="flex gap-1 mt-2">
                          <button
                            onClick={() => onRetryNow(item.id)}
                            className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-soft transition-colors"
                          >
                            Retry
                          </button>
                          <button
                            onClick={() => onCancelItem(item.id)}
                            className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded-soft transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {day.items.length === 0 && (
              <p className="text-xs text-text-secondary italic">No posts scheduled</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PublishingQueuePage() {
  const router = useRouter();
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "failed" | "cancelled">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"list" | "calendar" | "week">("list");
  // Calendar filters
  const [calPlatforms, setCalPlatforms] = useState<string[]>([]); // empty = all
  const [calApproval, setCalApproval] = useState<'all'|'pending'|'approved'|'rejected'>("all");
  const [calStatus, setCalStatus] = useState<'all'|'scheduled'|'published'|'failed'>("all");
  const searchParams = useSearchParams();

  useEffect(() => {
    fetchQueueItems();
    const interval = setInterval(fetchQueueItems, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Initialize view from query param (?view=calendar|week|list)
  useEffect(() => {
    const v = searchParams?.get("view");
    if (v === "calendar" || v === "week" || v === "list") {
      setView(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setViewAndUrl = (v: "list" | "calendar" | "week") => {
    setView(v);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set("view", v);
      router.replace(url.toString());
    }
  };

  const fetchQueueItems = async () => {
    try {
      const supabase = createClient();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/");
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
        setQueueItems([...data].sort(sortByDate));
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
    
    // Reset the item to pending and clear error; attempts increment on process
    const { error } = await supabase
      .from("publishing_queue")
      .update({
        status: "pending",
        scheduled_for: new Date().toISOString(),
        last_error: null,
        next_attempt_at: null
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
      .update({ status: "cancelled" })
      .eq("id", itemId);

    if (!error) {
      fetchQueueItems();
    }
  };

  const filteredItems = queueItems.filter(item => {
    if (filter === "all") return true;
    if (filter === "failed") return item.status === "failed";
    if (filter === "cancelled") return item.status === "cancelled";
    if (filter === "pending") return ["pending", "processing"].includes(item.status);
    return true;
  }).sort(sortByDate);

  const stats = {
    pending: queueItems.filter(i => ["pending", "processing"].includes(i.status)).length,
    failed: queueItems.filter(i => i.status === "failed").length,
    cancelled: queueItems.filter(i => i.status === "cancelled").length,
    completed: queueItems.filter(i => i.status === "completed").length,
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
              className="border border-input rounded-md h-10 px-4 text-sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Pending</p>
                <p className="text-2xl font-bold">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Cancelled</p>
                <p className="text-2xl font-bold">{stats.cancelled}</p>
              </div>
              <XCircle className="w-8 h-8 text-gray-400" />
            </div>
          </div>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Failed</p>
                <p className="text-2xl font-bold">{stats.failed}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </div>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Completed</p>
                <p className="text-2xl font-bold">{stats.completed}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </div>
        </div>

        {/* View Toggle and Filter Tabs */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-2">
            {["all", "pending", "failed", "cancelled"].map((f) => (
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
                    ({f === "pending" ? stats.pending : f === "failed" ? stats.failed : stats.cancelled})
                  </span>
                )}
              </button>
            ))}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setViewAndUrl("list")}
              className={`p-2 rounded-medium transition-colors ${
                view === "list"
                  ? "bg-primary text-white"
                  : "bg-surface text-text-secondary hover:bg-gray-100"
              }`}
              title="List View"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewAndUrl("week")}
              className={`p-2 rounded-medium transition-colors ${
                view === "week"
                  ? "bg-primary text-white"
                  : "bg-surface text-text-secondary hover:bg-gray-100"
              }`}
              title="Week View"
            >
              <Grid3X3 className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewAndUrl("calendar")}
              className={`p-2 rounded-medium transition-colors ${
                view === "calendar"
                  ? "bg-primary text-white"
                  : "bg-surface text-text-secondary hover:bg-gray-100"
              }`}
              title="Calendar View"
            >
              <CalendarDays className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Queue Items */}
        {view === "list" && (
          <div className="space-y-4">
            {filteredItems.length === 0 ? (
              <EmptyState
                title="No items in queue"
                body="Try a different filter or schedule a new post."
                primaryCta={{ label: 'Create Campaign', href: '/campaigns/new' }}
                secondaryCta={{ label: 'Open Calendar', href: '/publishing/queue?view=calendar', variant: 'outline' }}
              />
            ) : (
              filteredItems.map((item) => {
                const StatusIcon = STATUS_ICONS[item.status as keyof typeof STATUS_ICONS];
                return (
                  <div key={item.id} className="rounded-lg border bg-card text-card-foreground shadow-sm">
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
                              {item.social_connections?.platform === "google_my_business" && TERMS.GBP}
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
                            Scheduled: {formatDateTime(item.scheduled_for, getUserTimeZone())}
                          </span>
                          
                          {item.attempts > 0 && (
                            <span>Attempts: {item.attempts}/5</span>
                          )}
                          
                          {item.next_attempt_at && (
                            <span>
                              Next attempt: {formatDateTime(item.next_attempt_at, getUserTimeZone())}
                            </span>
                          )}
                        </div>
                        
                        {item.last_error && (
                          <div className="mt-2 p-2 bg-red-50 rounded-soft">
                            <p className="text-sm text-red-700">{item.last_error}</p>
                          </div>
                        )}
                        
                        {item.status === "failed" && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleRetryNow(item.id)}
              className="border border-input rounded-md px-3 py-1 text-sm"
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
        )}
        
        {view === "week" && (
          <WeekView items={filteredItems} onRetryNow={handleRetryNow} onCancelItem={handleCancelItem} />
        )}

        {view === "calendar" && (
          <>
            {/* Calendar Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">Platforms:</span>
                {['facebook','instagram','twitter','google_my_business'].map(p => {
                  const checked = calPlatforms.includes(p)
                  return (
                    <label key={p} className={`text-sm px-2 py-1 rounded-full border cursor-pointer ${checked ? 'bg-primary text-white border-primary' : 'bg-background text-text-secondary'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setCalPlatforms(prev => {
                            if (e.target.checked) return Array.from(new Set([...prev, p]))
                            return prev.filter(x => x !== p)
                          })
                        }}
                        className="hidden"
                      />
                      {p === 'google_my_business' ? 'GBP' : p.charAt(0).toUpperCase() + p.slice(1)}
                    </label>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">Approval:</span>
                <select value={calApproval} onChange={(e) => setCalApproval(e.target.value as any)} className="h-8 px-2 border rounded-md text-sm">
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">Status:</span>
                <select value={calStatus} onChange={(e) => setCalStatus(e.target.value as any)} className="h-8 px-2 border rounded-md text-sm">
                  <option value="all">All</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="published">Published</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
              <FullCalendar filters={{ platforms: calPlatforms, approval: calApproval, status: calStatus }} />
            </div>
          </>
        )}
        </Container>
      </main>
    </div>
  );
}
