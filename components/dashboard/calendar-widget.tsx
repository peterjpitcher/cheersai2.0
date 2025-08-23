"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Calendar, Clock, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import QuickPostModal from "@/components/quick-post-modal";
import PostEditModal from "@/components/dashboard/post-edit-modal";
import PlatformBadge from "@/components/ui/platform-badge";

interface MediaAsset {
  id: string;
  file_url: string;
  alt_text?: string;
  has_watermark?: boolean;
}

interface ScheduledPost {
  id: string;
  content: string;
  platform?: string;
  platforms?: string[];
  scheduled_for?: string;
  status?: string;
  is_quick_post?: boolean;
  media_url?: string;
  media_assets?: MediaAsset[];
  campaign?: {
    id: string;
    name: string;
    status: string;
    event_date?: string;
  };
}

export default function CalendarWidget() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickPostModalOpen, setQuickPostModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [editPostModalOpen, setEditPostModalOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);

  useEffect(() => {
    fetchScheduledPosts();
  }, [currentDate]);

  const fetchScheduledPosts = async () => {
    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      
      // Get start and end of current month
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      // Get current user's tenant_id first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("No authenticated user found");
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (userError) {
        console.error('Error fetching user data:', userError);
        setError("Failed to fetch user data");
        return;
      }

      if (!userData?.tenant_id) {
        setError("No tenant_id found for user");
        return;
      }

    // Fetch all campaign posts for this tenant with optional campaign data
    // Using LEFT JOIN to include posts without campaigns (like quick posts)
    const { data: campaignPosts, error: postsError } = await supabase
      .from("campaign_posts")
      .select(`
        id,
        content,
        scheduled_for,
        status,
        platform,
        platforms,
        is_quick_post,
        media_url,
        media_assets,
        campaign:campaigns(
          id,
          name,
          status,
          event_date
        )
      `)
      .eq("tenant_id", userData.tenant_id)
      .not("scheduled_for", "is", null)
      .gte("scheduled_for", startOfMonth.toISOString())
      .lte("scheduled_for", endOfMonth.toISOString())
      .order("scheduled_for");
    
    if (postsError) {
      console.error('Error fetching campaign posts:', postsError);
      console.error('Query details:', { 
        tenant_id: userData.tenant_id, 
        startOfMonth: startOfMonth.toISOString(), 
        endOfMonth: endOfMonth.toISOString() 
      });
    } else {
      console.log('Successfully fetched campaign posts:', campaignPosts?.length || 0);
    }

    // Also fetch campaigns with event dates in this month (draft campaigns without posts)
    const { data: campaigns, error: campaignsError } = await supabase
      .from("campaigns")
      .select(`
        id,
        name,
        status,
        event_date
      `)
      .eq("tenant_id", userData.tenant_id)
      .in("status", ["draft", "active"])
      .not("event_date", "is", null)
      .gte("event_date", startOfMonth.toISOString())
      .lte("event_date", endOfMonth.toISOString())
      .order("event_date");

    if (campaignsError) {
      console.error('Error fetching campaigns:', campaignsError);
    } else {
      console.log('Successfully fetched campaigns:', campaigns?.length || 0);
    }

    // Combine both sources
    const allPosts: ScheduledPost[] = [];
    
    // Add campaign posts with enhanced media data
    if (campaignPosts) {
      allPosts.push(...campaignPosts.map(post => ({
        ...post,
        scheduled_for: post.scheduled_for || post.campaign?.event_date,
        // Handle media_assets properly - convert UUID array to media objects if needed
        media_assets: Array.isArray(post.media_assets) && post.media_assets.length > 0 
          ? post.media_assets.map((assetId: string) => ({
              id: assetId,
              file_url: post.media_url || '', // Fallback to media_url if available
              alt_text: '',
              has_watermark: false
            }))
          : post.media_assets || []
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
              id: campaign.id,
              name: campaign.name,
              status: campaign.status,
              event_date: campaign.event_date
            }
          });
        }
      });
    }

      console.log('Calendar widget - fetched posts:', allPosts.length, 'for month:', formatMonth());
      console.log('Posts data:', allPosts);

      setScheduledPosts(allPosts);
    } catch (error) {
      console.error('Error in fetchScheduledPosts:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
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

  const handlePostEdit = (post: ScheduledPost, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent day click handler
    setSelectedPost(post);
    setEditPostModalOpen(true);
  };

  const handlePostEditSuccess = () => {
    setEditPostModalOpen(false);
    setSelectedPost(null);
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

      {/* Error State */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-medium">
          <p className="text-sm text-red-700">Error loading calendar: {error}</p>
          <button 
            onClick={() => fetchScheduledPosts()} 
            className="text-sm text-red-600 hover:text-red-800 underline mt-1"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mb-4 p-4 text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm text-text-secondary mt-2">Loading calendar...</p>
        </div>
      )}

      {/* Calendar Grid */}
      <div className={`grid grid-cols-7 gap-1 ${loading ? 'opacity-50' : ''}`}>
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
                aspect-square p-1 border border-border rounded-soft cursor-pointer hover:border-primary/50 transition-colors flex flex-col
                ${isToday ? "bg-primary/10 border-primary" : ""}
                ${hasDrafts && !hasScheduled ? "bg-yellow-50" : ""}
                ${hasScheduled ? "bg-success/5" : ""}
              `}
              title={postsForDay.length > 0 
                ? `${postsForDay.length} post${postsForDay.length !== 1 ? 's' : ''} - Click to view`
                : 'Click to create a quick post'
              }
            >
              <div className="text-xs font-semibold mb-1 flex-shrink-0">{day}</div>
              <div className="flex-1 min-h-0 overflow-hidden">
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
                    
                    // Get platforms for this post
                    const platforms = post.platforms || (post.platform ? [post.platform] : []);
                    
                    // Get thumbnail image
                    const thumbnailUrl = post.media_url || 
                      (post.media_assets && post.media_assets.length > 0 ? post.media_assets[0].file_url : null);
                    
                    // Truncate content for preview
                    const contentPreview = post.content ? 
                      post.content.substring(0, 60) + (post.content.length > 60 ? '...' : '') : '';
                    
                    return (
                      <div
                        key={post.id}
                        onClick={(e) => handlePostEdit(post, e)}
                        className={`text-xs rounded-soft overflow-hidden cursor-pointer hover:opacity-80 transition-opacity ${
                          isDraft ? "bg-yellow-50 border border-yellow-200" : "bg-primary/5 border border-primary/20"
                        }`}
                        title={`${label}${contentPreview ? `: ${contentPreview}` : ''} - ${platforms.length ? platforms.join(', ') : 'No platforms'} - Click to edit`}
                      >
                        {/* Post header with time and thumbnail */}
                        <div className="flex items-center gap-1 p-1">
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium truncate ${
                              isDraft ? "text-yellow-900" : "text-primary"
                            }`}>
                              {isDraft ? "📝" : "📅"} {time}
                            </div>
                            {contentPreview && (
                              <div className="text-xs text-gray-600 truncate mt-0.5">
                                {contentPreview}
                              </div>
                            )}
                          </div>
                          {thumbnailUrl && (
                            <div className="flex-shrink-0 w-8 h-8 relative bg-gray-100 rounded-soft overflow-hidden">
                              <Image
                                src={thumbnailUrl}
                                alt="Post thumbnail"
                                fill
                                className="object-cover"
                                sizes="32px"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                        </div>
                        
                        {/* Platform badges */}
                        {platforms.length > 0 && (
                          <div className="flex items-center gap-1 px-1 pb-1">
                            {platforms.slice(0, 3).map((platform, idx) => (
                              <PlatformBadge 
                                key={`${post.id}-${platform}-${idx}`}
                                platform={platform} 
                                size="sm" 
                                showLabel={false}
                                className="w-4 h-4 p-0.5"
                              />
                            ))}
                            {platforms.length > 3 && (
                              <span className="text-xs text-gray-500 ml-1">
                                +{platforms.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {postsForDay.length > 2 && (
                    <div className="text-xs text-text-secondary text-center bg-gray-50 rounded-soft py-1">
                      +{postsForDay.length - 2} more
                    </div>
                  )}
                </div>
              )}
              </div>
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

      {/* Post Edit Modal */}
      {selectedPost && (
        <PostEditModal
          isOpen={editPostModalOpen}
          onClose={() => {
            setEditPostModalOpen(false);
            setSelectedPost(null);
          }}
          onSuccess={handlePostEditSuccess}
          post={selectedPost}
        />
      )}
    </div>
  );
}