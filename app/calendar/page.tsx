'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Facebook,
  Instagram,
  Twitter,
  Linkedin
} from 'lucide-react';
import Link from 'next/link';
import { formatTime, formatDate, getUserTimeZone } from '@/lib/datetime';

interface ScheduledPost {
  id: string;
  campaign_id: string;
  campaign_name: string;
  content: string;
  platforms: string[];
  status: 'scheduled' | 'published' | 'failed';
  publish_at: string;
  published_at?: string;
  error?: string;
}

const platformIcons = {
  facebook: Facebook,
  instagram: Instagram,
  twitter: Twitter,
  // linkedin: Linkedin, // Coming soon
};

const platformColors = {
  facebook: 'bg-blue-500',
  instagram: 'bg-pink-500',
  twitter: 'bg-sky-500',
  // linkedin: 'bg-blue-700',
};

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');

  useEffect(() => {
    loadPosts();
  }, [currentDate, viewMode]);

  const loadPosts = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const startDate = getStartDate();
    const endDate = getEndDate();

    const { data, error } = await supabase
      .from('campaign_posts')
      .select(`
        *,
        campaign:campaigns(name, event_date)
      `)
      .gte('scheduled_for', startDate.toISOString())
      .lte('scheduled_for', endDate.toISOString())
      .order('scheduled_for', { ascending: true });

    if (!error && data) {
      setPosts(data.map((post: any) => ({
        ...post,
        campaign_name: post.campaign?.name || 'Quick Post',
        publish_at: post.scheduled_for, // Map to expected field name
      })));
    }
    setLoading(false);
  };

  const getStartDate = () => {
    const date = new Date(currentDate);
    if (viewMode === 'month') {
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
    } else if (viewMode === 'week') {
      const day = date.getDay();
      const diff = date.getDate() - day;
      date.setDate(diff);
      date.setHours(0, 0, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  };

  const getEndDate = () => {
    const date = new Date(currentDate);
    if (viewMode === 'month') {
      date.setMonth(date.getMonth() + 1);
      date.setDate(0);
      date.setHours(23, 59, 59, 999);
    } else if (viewMode === 'week') {
      const day = date.getDay();
      const diff = date.getDate() - day + 6;
      date.setDate(diff);
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(23, 59, 59, 999);
    }
    return date;
  };

  const navigatePrevious = () => {
    const date = new Date(currentDate);
    if (viewMode === 'month') {
      date.setMonth(date.getMonth() - 1);
    } else if (viewMode === 'week') {
      date.setDate(date.getDate() - 7);
    } else {
      date.setDate(date.getDate() - 1);
    }
    setCurrentDate(date);
  };

  const navigateNext = () => {
    const date = new Date(currentDate);
    if (viewMode === 'month') {
      date.setMonth(date.getMonth() + 1);
    } else if (viewMode === 'week') {
      date.setDate(date.getDate() + 7);
    } else {
      date.setDate(date.getDate() + 1);
    }
    setCurrentDate(date);
  };

  const getPostsForDate = (date: Date) => {
    return posts.filter(post => {
      const postDate = new Date(post.publish_at);
      return postDate.toDateString() === date.toDateString();
    });
  };

  const renderMonthView = () => {
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const days = [];
    const currentIterDate = new Date(startDate);

    while (currentIterDate <= lastDay || currentIterDate.getDay() !== 0) {
      days.push(new Date(currentIterDate));
      currentIterDate.setDate(currentIterDate.getDate() + 1);
    }

    return (
      <div className="grid grid-cols-7 gap-1">
        {(() => {
          // Render weekday headers using helper for consistency
          const base = new Date(2000, 0, 2); // Sunday
          return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86400000)).map((d, idx) => (
            <div key={idx} className="text-center font-semibold p-2 text-sm text-gray-600">
              {formatDate(d, undefined, { weekday: 'short' })}
            </div>
          ));
        })()}
        {days.map((day, index) => {
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = day.toDateString() === new Date().toDateString();
          const dayPosts = getPostsForDate(day);

          return (
            <div
              key={index}
              className={`
                min-h-[100px] p-2 border rounded-lg cursor-pointer
                ${isCurrentMonth ? 'bg-white' : 'bg-gray-50'}
                ${isToday ? 'ring-2 ring-blue-500' : ''}
                ${selectedDate?.toDateString() === day.toDateString() ? 'bg-blue-50' : ''}
                hover:bg-gray-50
              `}
              onClick={() => setSelectedDate(day)}
            >
              <div className="font-semibold text-sm mb-1">
                {day.getDate()}
              </div>
              <div className="space-y-1">
                {dayPosts.slice(0, 3).map((post) => (
                  <div
                    key={post.id}
                    className="text-xs p-1 rounded bg-gray-100 truncate"
                    title={post.content}
                  >
                    <div className="flex items-center gap-1">
                      {post.status === 'published' && <CheckCircle size={10} className="text-green-500" />}
                      {post.status === 'failed' && <XCircle size={10} className="text-red-500" />}
                      {post.status === 'scheduled' && <Clock size={10} className="text-blue-500" />}
                      <span className="truncate">{post.campaign_name}</span>
                    </div>
                  </div>
                ))}
                {dayPosts.length > 3 && (
                  <div className="text-xs text-gray-500">
                    +{dayPosts.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => {
    const tz = getUserTimeZone();
    const startDate = getStartDate();
    const days = [];
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(startDate);
      day.setDate(startDate.getDate() + i);
      days.push(day);
    }

    return (
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, index) => {
          const isToday = day.toDateString() === new Date().toDateString();
          const dayPosts = getPostsForDate(day);

          return (
            <div key={index} className="border rounded-lg">
              <div className={`p-2 text-center font-semibold ${isToday ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
                <div className="text-sm">{formatDate(day, undefined, { weekday: 'short' })}</div>
                <div className="text-lg">{day.getDate()}</div>
              </div>
              <div className="p-2 space-y-2 min-h-[400px]">
                {dayPosts.map((post) => (
                  <Card key={post.id} className="p-2 cursor-pointer hover:shadow-md">
                    <div className="text-xs text-gray-500 mb-1">{formatTime(post.publish_at, tz)}</div>
                    <div className="font-medium text-sm mb-1">{post.campaign_name}</div>
                    <div className="text-xs text-gray-600 line-clamp-2 mb-2">{post.content}</div>
                    <div className="flex gap-1">
                      {post.platforms.map((platform: string) => {
                        const Icon = platformIcons[platform as keyof typeof platformIcons];
                        return Icon ? (
                          <div
                            key={platform}
                            className={`w-5 h-5 rounded flex items-center justify-center ${platformColors[platform as keyof typeof platformColors]}`}
                          >
                            <Icon size={12} className="text-white" />
                          </div>
                        ) : null;
                      })}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const dayPosts = getPostsForDate(currentDate);

    return (
      <div className="border rounded-lg">
        <div className="bg-gray-100 p-4 font-semibold">
          {formatDate(currentDate, undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        <div className="divide-y">
          {hours.map((hour) => {
            const hourPosts = dayPosts.filter(post => {
              const postHour = new Date(post.publish_at).getHours();
              return postHour === hour;
            });

            return (
              <div key={hour} className="flex">
                <div className="w-20 p-2 text-right text-sm text-gray-500">
                  {hour.toString().padStart(2, '0')}:00
                </div>
                <div className="flex-1 p-2 min-h-[60px]">
                  {hourPosts.map((post) => (
                    <Card key={post.id} className="p-3 mb-2">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="font-medium">{post.campaign_name}</div>
                          <div className="text-sm text-gray-500">
                            {formatTime(post.publish_at, getUserTimeZone())}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {post.platforms.map((platform: string) => {
                            const Icon = platformIcons[platform as keyof typeof platformIcons];
                            return Icon ? (
                              <div
                                key={platform}
                                className={`w-6 h-6 rounded flex items-center justify-center ${platformColors[platform as keyof typeof platformColors]}`}
                              >
                                <Icon size={14} className="text-white" />
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">{post.content}</div>
                      <div className="mt-2">
                        {post.status === 'published' && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle size={12} /> Published
                          </span>
                        )}
                        {post.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600">
                            <XCircle size={12} /> Failed
                          </span>
                        )}
                        {post.status === 'scheduled' && (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                            <Clock size={12} /> Scheduled
                          </span>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Content Calendar</h1>
        <p className="text-gray-600">
          View and manage your scheduled social media posts
        </p>
      </div>

      {/* Controls */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={navigatePrevious}
              aria-label="Previous"
            >
              <ChevronLeft size={16} />
            </Button>
            
            <h2 className="text-xl font-semibold">
          {viewMode === 'month' && formatDate(currentDate, undefined, { month: 'long', year: 'numeric' })}
          {viewMode === 'week' && `Week of ${formatDate(getStartDate(), undefined, { month: 'short', day: 'numeric' })}`}
          {viewMode === 'day' && formatDate(currentDate, undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>
            
            <Button
              variant="outline"
              size="sm"
              onClick={navigateNext}
            >
              <ChevronRight size={16} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentDate(new Date())}
              aria-label="Today"
            >
              Today
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <Button
                size="sm"
                variant={viewMode === 'month' ? 'default' : 'ghost'}
                onClick={() => setViewMode('month')}
                aria-label="Month view"
              >
                Month
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'week' ? 'default' : 'ghost'}
                onClick={() => setViewMode('week')}
                aria-label="Week view"
              >
                Week
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'day' ? 'default' : 'ghost'}
                onClick={() => setViewMode('day')}
                aria-label="Day view"
              >
                Day
              </Button>
            </div>

            <Link href="/campaigns/new">
              <Button>
                <Plus size={16} className="mr-2" />
                New Post
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Calendar View */}
      <Card className="p-6">
        {loading ? (
          <div className="text-center py-12 text-gray-500">
            Loading calendar...
          </div>
        ) : (
          <>
            {viewMode === 'month' && renderMonthView()}
            {viewMode === 'week' && renderWeekView()}
            {viewMode === 'day' && renderDayView()}
          </>
        )}
      </Card>

      {/* Post Details Modal */}
      {selectedDate && viewMode === 'month' && (
        <Card className="mt-6 p-6">
          <h3 className="text-lg font-semibold mb-4">
            Posts for {formatDate(selectedDate, undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </h3>
          <div className="space-y-3">
            {getPostsForDate(selectedDate).length === 0 ? (
              <p className="text-gray-500">No posts scheduled for this date</p>
            ) : (
              getPostsForDate(selectedDate).map((post) => (
                <Card key={post.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium">{post.campaign_name}</div>
                      <div className="text-sm text-gray-500">{formatTime(post.publish_at, getUserTimeZone())}</div>
                    </div>
                    <div className="flex gap-1">
                      {post.platforms.map((platform: string) => {
                        const Icon = platformIcons[platform as keyof typeof platformIcons];
                        return Icon ? (
                          <div
                            key={platform}
                            className={`w-6 h-6 rounded flex items-center justify-center ${platformColors[platform as keyof typeof platformColors]}`}
                          >
                            <Icon size={14} className="text-white" />
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{post.content}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      {post.status === 'published' && (
                        <span className="inline-flex items-center gap-1 text-sm text-green-600">
                          <CheckCircle size={14} /> Published
                        </span>
                      )}
                      {post.status === 'failed' && (
                        <span className="inline-flex items-center gap-1 text-sm text-red-600">
                          <XCircle size={14} /> Failed: {post.error}
                        </span>
                      )}
                      {post.status === 'scheduled' && (
                        <span className="inline-flex items-center gap-1 text-sm text-blue-600">
                          <Clock size={14} /> Scheduled
                        </span>
                      )}
                    </div>
                    <Link href={`/campaigns/${post.campaign_id}`}>
                      <Button size="sm" variant="outline">
                        View Campaign
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
