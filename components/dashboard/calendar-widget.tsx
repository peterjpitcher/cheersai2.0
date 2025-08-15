"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Calendar, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

interface ScheduledPost {
  id: string;
  content: string;
  platform: string;
  publish_at: string;
  campaign: {
    name: string;
  };
}

export default function CalendarWidget({ tenantId }: { tenantId: string }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchScheduledPosts();
  }, [currentDate]);

  const fetchScheduledPosts = async () => {
    const supabase = createClient();
    
    // Get start and end of current month
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const { data } = await supabase
      .from("campaign_posts")
      .select(`
        id,
        content,
        platform,
        publish_at,
        campaign!inner(
          name,
          tenant_id
        )
      `)
      .eq("campaign.tenant_id", tenantId)
      .eq("status", "scheduled")
      .gte("publish_at", startOfMonth.toISOString())
      .lte("publish_at", endOfMonth.toISOString())
      .order("publish_at");

    if (data) {
      setScheduledPosts(data);
    }
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
      const postDate = new Date(post.publish_at);
      return postDate.getDate() === day;
    });
  };

  const formatMonth = () => {
    return currentDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
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

          return (
            <div
              key={day}
              className={`
                aspect-square p-1 border border-border rounded-soft
                ${isToday ? "bg-primary/10 border-primary" : ""}
                ${postsForDay.length > 0 ? "bg-success/5" : ""}
              `}
            >
              <div className="text-xs font-semibold mb-1">{day}</div>
              {postsForDay.length > 0 && (
                <div className="space-y-1">
                  {postsForDay.slice(0, 2).map(post => (
                    <div
                      key={post.id}
                      className="text-xs px-1 py-0.5 bg-primary/20 rounded-soft truncate"
                      title={`${post.campaign.name} - ${post.platform}`}
                    >
                      {new Date(post.publish_at).toLocaleTimeString("en-GB", { 
                        hour: "2-digit", 
                        minute: "2-digit" 
                      })}
                    </div>
                  ))}
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
    </div>
  );
}