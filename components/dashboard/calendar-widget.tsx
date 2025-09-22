"use client";

import { useState, useEffect, useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Clock, ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import QuickPostModal from "@/components/quick-post-modal";
import { toast } from 'sonner';
import PostEditModal from "@/components/dashboard/post-edit-modal";
import PlatformBadge from "@/components/ui/platform-badge";
import EmptyState from "@/components/ui/empty-state";
import { formatTime, formatDate, getUserTimeZone } from "@/lib/datetime";
import { useWeekStart } from "@/lib/hooks/useWeekStart";
import { sortByDate } from "@/lib/sortByDate";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScheduledPosts } from "@/lib/hooks/useScheduledPosts";

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
  approval_status?: 'pending' | 'approved' | 'rejected';
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
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'list'>("month");
  const [isSmall, setIsSmall] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [quickPostModalOpen, setQuickPostModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [editPostModalOpen, setEditPostModalOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  // Inspiration overlay state
  const [showInspiration, setShowInspiration] = useState<boolean>(true);
  const [inspoLoading, setInspoLoading] = useState<boolean>(false);
  const [inspoItems, setInspoItems] = useState<Array<{ date: string; event_id: string; name: string; category: string; alcohol: boolean; rank: number; hasBrief: boolean; brief?: string | null }>>([]);
  const [inspoDialogOpen, setInspoDialogOpen] = useState(false);
  const [inspoSelected, setInspoSelected] = useState<{ date: string; event_id: string; name: string; category: string; brief?: string | null } | null>(null);
  const [prefsLoading, setPrefsLoading] = useState<boolean>(true);
  const [showSports, setShowSports] = useState<boolean>(true);
  const [showAlcohol, setShowAlcohol] = useState<boolean>(true);

  const { weekStart } = useWeekStart();
  const handleThumbnailError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.display = 'none'
  }, [])

  const { posts, loading: postsLoading, error: postsError } = useScheduledPosts(currentDate, viewMode, weekStart);
  useEffect(() => {
    if (posts) setScheduledPosts(posts as ScheduledPost[]);
  }, [posts]);
  useEffect(() => {
    if (postsError) setError(postsError);
  }, [postsError]);

  // On mount: detect small screens, restore saved view, and enforce mobile-allowed views
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const applySize = (small: boolean) => setIsSmall(small);
    applySize(mq.matches);

    // Restore last view
    let saved = undefined as undefined | 'day' | 'week' | 'month' | 'list';
    try {
      const v = localStorage.getItem('calendar:viewMode');
      if (v === 'day' || v === 'week' || v === 'month' || v === 'list') saved = v;
    } catch {}
    let next: 'day' | 'week' | 'month' | 'list' = saved || 'month';
    // On small screens, restrict to month or list; default to list when invalid
    if (mq.matches && (next === 'day' || next === 'week')) next = 'list';
    if (mq.matches && !saved) next = 'list';
    setViewMode(next);

    const onChange = (e: MediaQueryListEvent) => {
      applySize(e.matches);
      if (e.matches) {
        // If switching to small and current is not allowed, coerce to list
        setViewMode((prev) => (prev === 'day' || prev === 'week' ? 'list' : prev));
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Persist chosen view
  useEffect(() => {
    try { localStorage.setItem('calendar:viewMode', viewMode); } catch {}
  }, [viewMode]);

  const fetchInspirationRange = useCallback(async () => {
    try {
      setInspoLoading(true);
      // compute view range same way as fetchScheduledPosts
      const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const startOfWeekLocal = (d: Date) => { const s = new Date(d); const dow = s.getDay(); const startIdx = weekStart === 'monday' ? 1 : 0; const diff = (dow - startIdx + 7) % 7; s.setDate(s.getDate() - diff); return startOfDay(s); };
      const endOfWeekLocal = (d: Date) => { const s = startOfWeekLocal(d); const e = new Date(s); e.setDate(s.getDate() + 6); return endOfDay(e); };
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      let rangeStart: Date;
      let rangeEnd: Date;
      if (viewMode === 'day') { rangeStart = startOfDay(currentDate); rangeEnd = endOfDay(currentDate) }
      else if (viewMode === 'week') { rangeStart = startOfWeekLocal(currentDate); rangeEnd = endOfWeekLocal(currentDate) }
      else if (viewMode === 'list') { rangeStart = startOfDay(new Date()); const plus30 = new Date(); plus30.setDate(plus30.getDate() + 30); rangeEnd = endOfDay(plus30) }
      else { rangeStart = startOfDay(startOfMonth); rangeEnd = endOfDay(endOfMonth) }

      const fmt = (d: Date) => d.toISOString().slice(0,10);
      const res = await fetch(`/api/inspiration?from=${fmt(rangeStart)}&to=${fmt(rangeEnd)}`);
      if (!res.ok) throw new Error('Failed to fetch inspiration');
      const json = await res.json();
      setInspoItems(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      console.error('Failed to fetch inspiration', e);
    } finally {
      setInspoLoading(false);
    }
  }, [currentDate, viewMode, weekStart]);

  useEffect(() => {
    // Load per-user inspiration prefs
    (async () => {
      try {
        setPrefsLoading(true);
        const res = await fetch('/api/inspiration/prefs');
        if (res.ok) {
          const json = await res.json();
          setShowSports(!!json.show_sports);
          setShowAlcohol(!!json.show_alcohol);
        }
      } finally {
        setPrefsLoading(false);
      }
    })();
  }, []);

  // Trigger hook-backed refetch by nudging the currentDate reference
  const triggerRefetch = () => setCurrentDate(d => new Date(d));

  useEffect(() => {
    if (!showInspiration) return
    fetchInspirationRange()
  }, [showInspiration, fetchInspirationRange])

  const categoryColor = (cat: string) => {
    switch (cat) {
      case 'seasonal': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'civic': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'food': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'drink': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'sports': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const updatePrefs = useCallback(async (next: { show_sports?: boolean; show_alcohol?: boolean }) => {
    try {
      await fetch('/api/inspiration/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      })
      // Refetch inspiration to apply filters server-side
      fetchInspirationRange();
    } catch (e) {
      console.error('Failed updating inspiration prefs', e);
    }
  }, [fetchInspirationRange])

  // ---- Brief parsing + rendering helpers ----
  type ParsedBrief = {
    summary?: string
    why?: string
    activation?: string[]
    angles?: string[]
    hashtags?: string[]
    assets?: string[]
    compliance?: string
  }

  function parseBrief(text?: string | null): ParsedBrief {
    if (!text) return {}
    const b = text.replace(/\r\n/g, '\n')
    const sections = {
      why: /\bWhy it matters:\s*([\s\S]*?)(?=\bActivation ideas:|\bContent angles:|\bHashtags:|\bAsset brief:|$)/i.exec(b)?.[1]?.trim(),
      activation: /\bActivation ideas:\s*([\s\S]*?)(?=\bContent angles:|\bHashtags:|\bAsset brief:|$)/i.exec(b)?.[1]?.trim(),
      angles: /\bContent angles:\s*([\s\S]*?)(?=\bHashtags:|\bAsset brief:|$)/i.exec(b)?.[1]?.trim(),
      hashtags: /\bHashtags:\s*([\s\S]*?)(?=\bAsset brief:|$)/i.exec(b)?.[1]?.trim(),
      assets: /\bAsset brief:\s*([\s\S]*?)(?=\bFor alcohol|$)/i.exec(b)?.[1]?.trim(),
      compliance: /\bFor alcohol[\s\S]*?\.?$/i.exec(b)?.[0]?.trim(),
    }
    const headEnd = b.search(/\bWhy it matters:/i)
    const summary = headEnd > 0 ? b.slice(0, headEnd).trim() : b.trim()

    const toList = (s?: string) => (s ? s.split(/;|\n|•/).map(x => x.trim()).filter(Boolean) : [])
    const toTags = (s?: string) => (s ? s.split(/[\s,]+/).filter(t => /^#/.test(t)).slice(0, 15) : [])

    return {
      summary,
      why: sections.why,
      activation: toList(sections.activation),
      angles: toList(sections.angles),
      hashtags: toTags(sections.hashtags),
      assets: toList(sections.assets),
      compliance: sections.compliance,
    }
  }

  function BriefView({ brief }: { brief?: string | null }) {
    const p = parseBrief(brief)
    if (!brief) return <div className="text-sm text-text-secondary">No brief available</div>
    return (
      <div className="space-y-3">
        {p.summary && (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Summary</div>
            <div className="text-sm">{p.summary}</div>
          </div>
        )}
        {p.why && (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Why it matters</div>
            <div className="text-sm">{p.why}</div>
          </div>
        )}
        {!!(p.activation && p.activation.length) && (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Activation ideas</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {p.activation!.map((it, i) => <li key={`act-${i}`}>{it}</li>)}
            </ul>
          </div>
        )}
        {!!(p.angles && p.angles.length) && (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Content angles</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {p.angles!.map((it, i) => <li key={`ang-${i}`}>{it}</li>)}
            </ul>
          </div>
        )}
        {!!(p.assets && p.assets.length) && (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Asset brief</div>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {p.assets!.map((it, i) => <li key={`ast-${i}`}>{it}</li>)}
            </ul>
          </div>
        )}
        {!!(p.hashtags && p.hashtags.length) && (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Hashtags</div>
            <div className="flex flex-wrap gap-1">
              {p.hashtags!.map((t, i) => (
                <span key={`tag-${i}`} className="rounded-card border border-border bg-muted px-2 py-0.5 text-xs">{t}</span>
              ))}
            </div>
          </div>
        )}
        {p.compliance && (
          <div className="text-xs text-text-secondary">{p.compliance}</div>
        )}
      </div>
    )
  }

  const inspoForDate = (day: number) => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth() + 1;
    const d = String(day).padStart(2,'0');
    const dateKey = `${y}-${String(m).padStart(2,'0')}-${d}`;
    // Deduplicate by event_id (fallback to name) per day before taking top 2
    const seen = new Set<string>();
    const dayItems = inspoItems
      .filter(i => i.date === dateKey)
      .sort((a,b) => b.rank - a.rank)
      .filter(i => {
        const key = i.event_id || `${i.name}|${i.category}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0,2);
    return dayItems;
  };

  const getDaysInMonth = () => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = () => {
    const g = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    return weekStart === 'monday' ? (g === 0 ? 6 : g - 1) : g;
  };

  const navigate = (direction: number) => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
    } else if (viewMode === 'week') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + direction * 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + direction);
      setCurrentDate(d);
    }
  };

  const getPostsForDay = (day: number) => {
    return scheduledPosts.filter(post => {
      if (!post.scheduled_for) return false;
      const postDate = new Date(post.scheduled_for);
      return postDate.getDate() === day && 
             postDate.getMonth() === currentDate.getMonth() &&
             postDate.getFullYear() === currentDate.getFullYear();
    }).sort((a, b) => sortByDate(a, b));
  };

  const formatMonth = () => formatDate(currentDate, undefined, { month: 'long', year: 'numeric' });

  const startOfWeek = (date: Date) => { const d = new Date(date); const dow = d.getDay(); const startIdx = weekStart === 'monday' ? 1 : 0; const diff = (dow - startIdx + 7) % 7; d.setDate(d.getDate() - diff); d.setHours(0,0,0,0); return d; };

  const endOfWeek = (date: Date) => {
    const s = startOfWeek(date);
    const d = new Date(s);
    d.setDate(s.getDate() + 6);
    d.setHours(23,59,59,999);
    return d;
  };

  const sameDay = (a: Date, b: Date) => (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );

  const handleDayClick = (day: number, posts: ScheduledPost[]) => {
    if (posts.length > 0) {
      // If there are posts, navigate to the first post or campaign
      const firstPost = posts[0];
      if (firstPost.campaign) {
        // Navigate to campaign page
        router.push(`/campaigns/${firstPost.id}`);
      } else if (firstPost.is_quick_post || !firstPost.campaign) {
        // For quick posts or posts without campaign, go to calendar view
        router.push("/publishing/queue?view=calendar");
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

  const handleDayKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    day: number,
    posts: ScheduledPost[],
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleDayClick(day, posts);
    }
  };

  const handleQuickPostSuccess = () => {
    setQuickPostModalOpen(false);
    triggerRefetch();
  };

  const handlePostEdit = (
    post: ScheduledPost,
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>
  ) => {
    event.stopPropagation(); // Prevent day click handler
    setSelectedPost(post);
    setEditPostModalOpen(true);
  };

  const handlePostEditSuccess = () => {
    setEditPostModalOpen(false);
    setSelectedPost(null);
    triggerRefetch();
  };

  // Shared renderer for post preview snippets
  const renderPostPreview = (post: ScheduledPost, mode: 'compact' | 'full' = 'compact') => {
    const tz = getUserTimeZone();
    const isDraft = post.status === "draft" || post.campaign?.status === "draft";
    const isCampaignManaged = Boolean(post.campaign && !post.is_quick_post);
    const time = post.scheduled_for ? formatTime(post.scheduled_for, tz) : "draft";
    const label = post.is_quick_post ? "Quick" : post.campaign?.name || "Post";
    const platforms = post.platforms || (post.platform ? [post.platform] : []);
    const thumbnailUrl = post.media_url || (post.media_assets && post.media_assets.length > 0 ? post.media_assets[0].file_url : null);
    const contentPreview = post.content ? post.content.substring(0, mode === 'full' ? 200 : 60) + ((post.content.length > (mode === 'full' ? 200 : 60)) ? "..." : "") : "";
    const appr = (post.approval_status || 'pending');

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handlePostEdit(post, event);
      }
    };

    return (
      <div
        role="button"
        tabIndex={0}
        key={post.id}
        onClick={(event) => handlePostEdit(post, event)}
        onKeyDown={handleKeyDown}
        className={`w-full overflow-hidden rounded-card text-left text-xs transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary/60 focus-visible:ring-2 focus-visible:ring-primary/60 ${
          isDraft ? "border border-yellow-200 bg-yellow-50" : "border border-primary/20 bg-primary/5"
        }`}
        title={`${label}${contentPreview ? `: ${contentPreview}` : ''} - ${platforms.length ? platforms.join(', ') : 'No platforms'} - Click to ${isCampaignManaged ? 'view details' : 'edit'}`}
      >
        <div className="flex items-start gap-2 p-2">
          {thumbnailUrl && (
            <div className={`${mode === 'full' ? 'size-12' : 'size-8'} relative shrink-0 overflow-hidden rounded-card bg-gray-100`}>
              <Image src={thumbnailUrl} alt="Post thumbnail" fill className="object-cover" sizes={mode === 'full' ? '48px' : '32px'} onError={handleThumbnailError} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className={`truncate font-medium ${isDraft ? "text-yellow-900" : "text-primary"}`}>
              {isDraft ? "📝" : "📅"} {time}
            </div>
            {/* Approval badge */}
            <div className="mt-0.5">
              {appr === 'approved' && (
                <span className="inline-flex items-center gap-1 rounded border border-green-200 bg-green-100 px-1.5 py-0.5 text-[10px] text-green-800">Approved</span>
              )}
              {appr === 'pending' && (
                <span className="inline-flex items-center gap-1 rounded border border-yellow-200 bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-800">Pending</span>
              )}
              {appr === 'rejected' && (
                <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800">Rejected</span>
              )}
            </div>
            {contentPreview && (
              <div className={`mt-0.5 whitespace-pre-wrap text-[11px] text-gray-700`}>{contentPreview}</div>
            )}
            {platforms.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {platforms.slice(0, mode === 'full' ? 5 : 3).map((platform, idx) => (
                  <PlatformBadge key={`${post.id}-${platform}-${idx}`} platform={platform} size={mode === 'full' ? 'md' : 'sm'} showLabel={mode === 'full'} className={mode === 'full' ? '' : 'size-4 p-0.5'} />
                ))}
                {platforms.length > (mode === 'full' ? 5 : 3) && (
                  <span className="ml-1 text-[10px] text-gray-500">+{platforms.length - (mode === 'full' ? 5 : 3)}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // For day/week timelines
  const getPostsForDateHour = (date: Date, hour: number) => {
    return scheduledPosts
      .filter(p => {
        if (!p.scheduled_for) return false;
        const d = new Date(p.scheduled_for);
        return sameDay(d, date) && d.getHours() === hour;
      })
      .sort((a, b) => sortByDate(a, b));
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const today = new Date();
  const daysInMonth = getDaysInMonth();
  const firstDayOfMonth = getFirstDayOfMonth();
  const days = weekStart === 'monday' ? ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // Create array of days with proper offset
  const calendarDays = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  return (
    <div className="w-full rounded-card border bg-card p-4 text-card-foreground shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-chip bg-success/10 p-3">
            <Calendar className="size-6 text-success" />
          </div>
          <div>
            <h3 className="font-heading text-lg font-bold">Content Calendar</h3>
            <p className="text-sm text-text-secondary">Schedule and manage your posts</p>
          </div>
        </div>
        <div className="inline-flex overflow-hidden overflow-x-auto rounded-chip border border-border">
          {(isSmall ? (['month','list'] as const) : (['day','week','month','list'] as const)).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-sm transition-colors ${viewMode === mode ? 'bg-primary text-white' : 'bg-background hover:bg-surface'} ${mode !== 'day' ? 'border-l border-border' : ''}`}
              aria-pressed={viewMode === mode}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation and Title */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="rounded-chip p-2 transition-colors hover:bg-surface"
          aria-label="Previous"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h4 className="font-semibold">
          {viewMode === 'month' && formatMonth()}
          {viewMode === 'week' && (() => {
            const s = startOfWeek(currentDate);
            const e = endOfWeek(currentDate);
            const fmt = (d: Date) => formatDate(d, undefined, { day: 'numeric', month: 'short' });
            return `Week of ${fmt(s)} – ${fmt(e)}`;
          })()}
          {viewMode === 'day' && formatDate(currentDate, undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          {viewMode === 'list' && (() => {
            const s = new Date(currentDate);
            const fmt = (d: Date) => formatDate(d, undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            return `Scheduled (from ${fmt(s)})`;
          })()}
        </h4>
        <button
          onClick={() => navigate(1)}
          className="rounded-chip p-2 transition-colors hover:bg-surface"
          aria-label="Next"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      {/* Inspiration + Prefs */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={showInspiration} onChange={(e) => setShowInspiration(e.target.checked)} />
          <span className="flex items-center gap-1"><Lightbulb className="size-4 text-amber-500"/> Inspiration overlay {inspoLoading && <span className="text-text-secondary">(loading…)</span>}</span>
        </label>
        <div className="flex items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={showSports} disabled={prefsLoading} onChange={(e) => { setShowSports(e.target.checked); updatePrefs({ show_sports: e.target.checked }) }} />
            <span>Sports</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={showAlcohol} disabled={prefsLoading} onChange={(e) => { setShowAlcohol(e.target.checked); updatePrefs({ show_alcohol: e.target.checked }) }} />
            <span>Alcohol</span>
          </label>
        </div>
      </div>

      {/* Error State */}
      {(error || postsError) && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">Error loading calendar: {error || postsError}</p>
          <button 
            onClick={() => triggerRefetch()} 
            className="mt-1 text-sm text-red-600 underline hover:text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading State */}
      {postsLoading && (
        <div className="mb-4 p-4 text-center">
          <div className="mx-auto size-6 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="mt-2 text-sm text-text-secondary">Loading calendar...</p>
        </div>
      )}

      {/* Month View */}
      {viewMode === 'month' && (
      <div className={`grid w-full grid-cols-7 gap-1 ${postsLoading ? 'opacity-50' : ''}`}>
        {/* Day headers */}
        {days.map(day => (
          <div key={day} className="py-2 text-center text-xs font-semibold text-text-secondary">
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="min-h-[100px]" />;
          }

          const postsForDay = getPostsForDay(day);
          const isToday = 
            day === today.getDate() && 
            currentDate.getMonth() === today.getMonth() && 
            currentDate.getFullYear() === today.getFullYear();

          // Determine if there are draft or scheduled posts
          const hasDrafts = postsForDay.some(p => p.status === "draft" || p.campaign?.status === "draft");
          const hasScheduled = postsForDay.some(p => p.status === "scheduled" || (!p.status && !p.campaign?.status));
          return (
            <button
              type="button"
              key={day}
              onClick={() => handleDayClick(day, postsForDay)}
              onKeyDown={(event) => handleDayKeyDown(event, day, postsForDay)}
              className={`
                flex min-h-[100px] flex-col rounded-card border border-border p-1 text-left transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/60
                ${isToday ? "border-primary bg-primary/10" : ""}
                ${hasDrafts && !hasScheduled ? "bg-yellow-50" : ""}
                ${hasScheduled ? "bg-success/5" : ""}
              `}
              title={postsForDay.length > 0 
                ? `${postsForDay.length} post${postsForDay.length !== 1 ? 's' : ''} - Click to view`
                : 'Click to create a quick post'
              }
            >
              <div className="mb-1 shrink-0 text-xs font-semibold">{day}</div>
              {showInspiration && inspoForDate(day).length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {inspoForDate(day).map((ii, idx) => (
                    <button
                      key={`${ii.date}-${idx}`}
                      onClick={(e) => { e.stopPropagation(); setInspoSelected({ date: ii.date, event_id: ii.event_id, name: ii.name, category: ii.category, brief: ii.brief }); setInspoDialogOpen(true); }}
                      className={`rounded-md border px-2 py-0.5 text-[10px] ${categoryColor(ii.category)} hover:opacity-90`}
                      title={`${ii.name}`}
                    >
                      {ii.name}
                    </button>
                  ))}
                </div>
              )}
              {postsForDay.length > 0 && (
                <div className="space-y-1">
                  {postsForDay.map(p => renderPostPreview(p, 'compact'))}
                </div>
              )}
            </button>
          );
        })}
      </div>
      )}

      {/* Week View */}
      {viewMode === 'week' && (() => {
        const s = startOfWeek(currentDate);
        const dates = Array.from({ length: 7 }, (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i));
        return (
          <div className="w-full overflow-auto">
            <div className="grid w-full min-w-[720px] grid-cols-[64px_repeat(7,1fr)] gap-2">
              {/* Header row */}
              <div></div>
              {dates.map((d, i) => (
                <div key={`wh-${i}`} className="text-center text-xs font-semibold text-text-secondary">
                  {formatDate(d, undefined, { weekday: 'short' })} {d.getDate()}
                </div>
              ))}
              {/* Hours rows */}
              {hours.map((h) => (
                <div className="contents" key={`w-row-${h}`}>
                  <div className="pr-1 text-right text-[10px] leading-5 text-text-secondary">
                    {formatTime(new Date(2000,0,1,h), getUserTimeZone())}
                  </div>
                  {dates.map((d, i) => (
                    <div key={`wc-${h}-${i}`} className="min-h-10 rounded-card border border-border bg-white p-1">
                      <div className="space-y-1">
                        {getPostsForDateHour(d, h).map(p => renderPostPreview(p, 'full'))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Day View */}
      {viewMode === 'day' && (() => {
        return (
          <div className="overflow-hidden rounded-medium border bg-white p-0">
            <div className="grid grid-cols-[64px_1fr]">
              {hours.map(h => (
                <div className="contents" key={`d-row-${h}`}>
                  <div className="border-b border-border py-2 pr-2 text-right text-[10px] text-text-secondary">
                    {formatTime(new Date(2000,0,1,h), getUserTimeZone())}
                  </div>
                  <div className="border-b border-border p-2">
                    <div className="space-y-2">
                      {getPostsForDateHour(currentDate, h).map(p => renderPostPreview(p, 'full'))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* List View */}
      {viewMode === 'list' && (() => {
        const upcoming = [...scheduledPosts]
          .filter(p => p.scheduled_for && p.status !== 'published')
          .sort((a, b) => sortByDate(a, b));

        const filtered = approvalFilter === 'all' 
          ? upcoming 
          : upcoming.filter(p => (p.approval_status || 'pending') === approvalFilter);

        const toggleSelect = (id: string) => {
          setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        };

        const allSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));
        const toggleSelectAll = () => {
          setSelectedIds(() => {
            if (allSelected) return new Set<string>();
            const next = new Set<string>();
            filtered.forEach(p => next.add(p.id));
            return next;
          });
        };

        const handleInlineDelete = async (id: string) => {
          if (!confirm('Delete this post?')) return;
          try {
            const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Request failed');
            triggerRefetch();
            setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            toast.success('Post deleted');
          } catch (e) {
            console.error('Failed to delete', e);
            toast.error('Failed to delete post');
          }
        };

        const handleBulkDelete = async () => {
          if (selectedIds.size === 0) return;
          if (!confirm(`Delete ${selectedIds.size} selected post(s)?`)) return;
          setBulkDeleting(true);
          try {
            const results = await Promise.allSettled(Array.from(selectedIds).map(async id => {
              const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
              if (!res.ok) throw new Error('Failed');
              return id;
            }));
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            setSelectedIds(new Set());
            triggerRefetch();
            if (successCount > 0) toast.success(`Deleted ${successCount} post${successCount !== 1 ? 's' : ''}`);
          } finally {
            setBulkDeleting(false);
          }
        };

        return (
          <div className="rounded-medium border bg-white">
            <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <input type="checkbox" className="size-4" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                <span className="text-sm text-text-secondary">{filtered.length} scheduled</span>
              </div>
              <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
                {/* Approval filter */}
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  <span className="text-text-secondary">Approval:</span>
                  {(['all','pending','approved','rejected'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setApprovalFilter(f)}
                      className={`rounded-md border px-2 py-1 ${approvalFilter===f ? 'border-primary bg-primary text-white' : 'border-input hover:bg-muted'}`}
                      aria-pressed={approvalFilter===f}
                    >
                      {f.charAt(0).toUpperCase()+f.slice(1)}
                    </button>
                  ))}
                </div>
                <Button onClick={handleBulkDelete} loading={bulkDeleting} disabled={selectedIds.size === 0} size="sm" variant="destructive">
                  Delete Selected ({selectedIds.size})
                </Button>
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-2">
                <EmptyState
                  title="No scheduled posts"
                  body={<span className="text-sm">Create or schedule posts to see them here.</span>}
                  primaryCta={{ label: 'Create Campaign', href: '/campaigns/new' }}
                  secondaryCta={{ label: 'Open Queue', href: '/publishing/queue', variant: 'outline' }}
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map(p => {
                  const t = p.scheduled_for 
                    ? `${formatDate(p.scheduled_for, getUserTimeZone(), { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatTime(p.scheduled_for, getUserTimeZone())}`
                    : '';
                  const platforms = p.platforms || (p.platform ? [p.platform] : []);
                  const thumb = p.media_url || p.media_assets?.[0]?.file_url;
                  const selected = selectedIds.has(p.id);
                  const appr = (p.approval_status || 'pending');
                  return (
                    <li key={p.id} className="flex items-center gap-3 p-3">
                      <input type="checkbox" className="size-4" checked={selected} onChange={() => toggleSelect(p.id)} aria-label="Select post" />
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-soft bg-gray-100">
                        {thumb ? <Image src={thumb} alt="" fill sizes="48px" className="object-cover" onError={handleThumbnailError} /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.content?.slice(0, 120) || '(No content)'}{p.content && p.content.length > 120 ? '…' : ''}</div>
                        <div className="mt-0.5 text-xs text-text-secondary">{t}</div>
                        {platforms.length > 0 && (
                          <div className="mt-1 flex items-center gap-1">
                            {platforms.slice(0,5).map((pf, i) => (
                              <PlatformBadge key={`${p.id}-${pf}-${i}`} platform={pf} size="sm" showLabel={false} />
                            ))}
                          </div>
                        )}
                        {/* Approval badge */}
                        <div className="mt-1">
                          {appr === 'approved' && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-100 px-2 py-0.5 text-[11px] text-green-800">
                              <svg viewBox="0 0 24 24" className="size-3" fill="currentColor"><path d="M9 16.17l-3.88-3.88-1.41 1.41L9 19 20.29 7.71l-1.41-1.41z"></path></svg>
                              Approved
                            </span>
                          )}
                          {appr === 'pending' && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-yellow-200 bg-yellow-100 px-2 py-0.5 text-[11px] text-yellow-800">
                              <svg viewBox="0 0 24 24" className="size-3" fill="currentColor"><path d="M12 7v5l4 2"></path></svg>
                              Pending
                            </span>
                          )}
                          {appr === 'rejected' && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] text-red-800">
                              <svg viewBox="0 0 24 24" className="size-3" fill="currentColor"><path d="M18.3 5.71L12 12.01 5.7 5.7 4.29 7.11l6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.29 6.3 1.42-1.41-6.3-6.3 6.3-6.29z"></path></svg>
                              Rejected
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(event) => { event.preventDefault(); handlePostEdit(p, event); }} className="rounded-md border border-input px-3 py-1.5 text-sm">Edit</button>
                        <button onClick={() => handleInlineDelete(p.id)} className="rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
  })()}

      {/* Quick Stats */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-text-secondary" />
            <span className="text-text-secondary">
              {viewMode === 'month' ? 'This month:' : viewMode === 'week' ? 'This week:' : viewMode === 'day' ? 'This day:' : 'Scheduled:'}
            </span>
            <span className="font-semibold">{scheduledPosts.length} post{scheduledPosts.length !== 1 ? 's' : ''} scheduled</span>
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
        initialContent={inspoSelected?.brief || undefined}
        initialInspiration={inspoSelected?.brief || undefined}
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

      {/* Inspiration Dialog */}
      <Dialog open={inspoDialogOpen} onOpenChange={setInspoDialogOpen}>
        <DialogContent aria-describedby={undefined} className="p-0 sm:max-w-3xl">
          <DialogHeader className="px-6 py-4">
            <DialogTitle>{inspoSelected?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 pb-6">
            <div className="text-xs text-text-secondary">{inspoSelected?.date} • {inspoSelected?.category}</div>
            <BriefView brief={inspoSelected?.brief} />
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setInspoDialogOpen(false)}>Close</Button>
              <Button onClick={() => { setQuickPostModalOpen(true); setInspoDialogOpen(false); }}>Add Draft</Button>
              {inspoSelected?.event_id && (
                <button
                  className="text-sm text-text-secondary transition-colors hover:text-primary"
                  onClick={async () => {
                    try {
                      await fetch('/api/inspiration/snoozes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ event_id: inspoSelected.event_id, date: inspoSelected.date })
                      })
                      setInspoDialogOpen(false)
                      fetchInspirationRange()
                    } catch (e) { console.error(e) }
                  }}
                >
                  Snooze
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
