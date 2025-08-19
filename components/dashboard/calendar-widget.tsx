"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Calendar, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import QuickPostModal from "@/components/quick-post-modal";

interface ScheduledPost {
  id: string;
  content: string;
  platform?: string;
  scheduled_for?: string;
  status?: string;
  is_quick_post?: boolean;
  campaign?: {
    name: string;
    status: string;
    event_date?: string;
  };
}

export default function CalendarWidget({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickPostModalOpen, setQuickPostModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    fetchScheduledPosts();
  }, [currentDate]);

  const fetchScheduledPosts = async () => {
    const supabase = createClient();
    
    // Get start and end of current month
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Fetch campaign posts (both draft and scheduled)
    // Note: Filter by tenant_id if column exists, otherwise filter via campaign relationship
    const { data: campaignPosts } = await supabase
      .from("campaign_posts")
      .select(`
        id,
        content,
        scheduled_for,
        status,
        tenant_id,
        campaign:campaigns(
          name,
          status,
          event_date,
          tenant_id
        )
      `)
      .eq("tenant_id", tenantId)
      .gte("scheduled_for", startOfMonth.toISOString())
      .lte("scheduled_for", endOfMonth.toISOString())
      .order("scheduled_for");

    // Also fetch campaigns with event dates in this month (draft campaigns)
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select(`
        id,
        name,
        status,
        event_date
      `)
      .eq("tenant_id", tenantId)
      .eq("status", "draft")
      .gte("event_date", startOfMonth.toISOString())
      .lte("event_date", endOfMonth.toISOString())
      .order("event_date");

    // Combine both sources
    const allPosts: ScheduledPost[] = [];
    
    // Add campaign posts
    if (campaignPosts) {
      allPosts.push(...campaignPosts.map(post => ({
        ...post,
        scheduled_for: post.scheduled_for || post.campaign?.event_date
      })));
    }
    
    // Add draft campaigns that don't have posts yet
    if (campaigns) {
      campaigns.forEach(campaign => {
        // Check if this campaign already has posts in our list
        const hasPost = allPosts.some(p => p.campaign?.name === campaign.name);
        if (!hasPost && campaign.event_date) {
          allPosts.push({
            id: campaign.id,
            content: `Draft: ${campaign.name}`,
            scheduled_for: campaign.event_date,
            status: "draft",
            campaign: {
              name: campaign.name,
              status: campaign.status,
              event_date: campaign.event_date
            }
          });
        }
      });
    }

    setScheduledPosts(allPosts);
    setLoading(false);
  };

  const getDaysInMonth = () => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = () => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  };

  const navigateMonth = (direction: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
  };

  const getPostsForDay = (day: number) => {
    return scheduledPosts.filter(post => {
      if (!post.scheduled_for) return false;
      const postDate = new Date(post.scheduled_for);
      return postDate.getDate() === day && 
             postDate.getMonth() === currentDate.getMonth() &&
             postDate.getFullYear() === currentDate.getFullYear();
    });
  };

  const formatMonth = () => {
    return currentDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };

  const handleDayClick = (day: number, posts: ScheduledPost[]) => {
    if (posts.length > 0) {
      // If there are posts, navigate to the first post or campaign
      const firstPost = posts[0];
      if (firstPost.campaign) {
        // Navigate to campaign page
        router.push(`/campaigns/${firstPost.id}`);
      } else if (firstPost.is_quick_post || !firstPost.campaign) {
        // For quick posts or posts without campaign, go to calendar view
        router.push("/calendar");
      } else {
        // Navigate to post edit page
        router.push(`/campaigns/${firstPost.id}`);
      }
    } else {
      // If no posts, open quick post modal with the selected date
      const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
      setSelectedDate(clickedDate);
      setQuickPostModalOpen(true);
    }
  };

  const handleQuickPostSuccess = () => {
    setQuickPostModalOpen(false);
    fetchScheduledPosts(); // Refresh the calendar
  };

  const today = new Date();
  const daysInMonth = getDaysInMonth();
  const firstDayOfMonth = getFirstDayOfMonth();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Create array of days with proper offset
  const calendarDays = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-success/10 p-3 rounded-medium">
            <Calendar className="w-6 h-6 text-success" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-lg">Content Calendar</h3>
            <p className="text-sm text-text-secondary">Schedule and manage your posts</p>
          </div>
        </div>
        <Link href="/calendar" className="btn-secondary text-sm">
          View Full Calendar
        </Link>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigateMonth(-1)}
          className="p-2 hover:bg-surface rounded-medium transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h4 className="font-semibold">{formatMonth()}</h4>
        <button
          onClick={() => navigateMonth(1)}
          className="p-2 hover:bg-surface rounded-medium transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Day headers */}
        {days.map(day => (
          <div key={day} className="text-center text-xs font-semibold text-text-secondary py-2">
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="aspect-square" />;
          }

          const postsForDay = getPostsForDay(day);
          const isToday = 
            day === today.getDate() && 
            currentDate.getMonth() === today.getMonth() && 
            currentDate.getFullYear() === today.getFullYear();

          // Determine if there are draft or scheduled posts
          const hasDrafts = postsForDay.some(p => p.status === "draft" || p.campaign?.status === "draft");
          const hasScheduled = postsForDay.some(p => p.status === "scheduled" || (!p.status && !p.campaign?.status));
          const hasQuickPosts = postsForDay.some(p => p.is_quick_post);

          return (
            <div
              key={day}
              onClick={() => handleDayClick(day, postsForDay)}
              className={`
                aspect-square p-1 border border-border rounded-soft cursor-pointer hover:border-primary/50 transition-colors
                ${isToday ? "bg-primary/10 border-primary" : ""}
                ${hasDrafts && !hasScheduled ? "bg-yellow-50" : ""}
                ${hasScheduled ? "bg-success/5" : ""}
              `}
              title={postsForDay.length > 0 
                ? `${postsForDay.length} post${postsForDay.length !== 1 ? 's' : ''} - Click to view`
                : 'Click to create a quick post'
              }
            >
              <div className="text-xs font-semibold mb-1">{day}</div>
              {postsForDay.length > 0 && (
                <div className="space-y-1">
                  {postsForDay.slice(0, 2).map(post => {
                    const isDraft = post.status === "draft" || post.campaign?.status === "draft";
                    const label = post.is_quick_post 
                      ? "Quick" 
                      : post.campaign?.name || "Post";
                    const time = post.scheduled_for 
                      ? new Date(post.scheduled_for).toLocaleTimeString("en-GB", { 
                          hour: "2-digit", 
                          minute: "2-digit" 
                        })
                      : "Draft";
                    
                    return (
                      <div
                        key={post.id}
                        className={`text-xs px-1 py-0.5 rounded-soft truncate ${
                          isDraft ? "bg-yellow-200 text-yellow-900" : "bg-primary/20 text-primary"
                        }`}
                        title={`${label} - ${post.platform || 'Multiple'}`}
                      >
                        {isDraft ? "📝" : "📅"} {time}
                      </div>
                    );
                  })}
                  {postsForDay.length > 2 && (
                    <div className="text-xs text-text-secondary text-center">
                      +{postsForDay.length - 2}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Stats */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-secondary" />
            <span className="text-text-secondary">This month:</span>
            <span className="font-semibold">{scheduledPosts.length} posts scheduled</span>
          </div>
          <Link href="/campaigns/new" className="text-primary hover:underline">
            Schedule more →
          </Link>
        </div>
      </div>

      {/* Quick Post Modal */}
      <QuickPostModal
        isOpen={quickPostModalOpen}
        onClose={() => {
          setQuickPostModalOpen(false);
          setSelectedDate(null);
        }}
        onSuccess={handleQuickPostSuccess}
        defaultDate={selectedDate}
      />
    </div>
  );
}