"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Calendar, Clock, ChevronLeft, ChevronRight, ImageIcon, Lightbulb } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    fetchScheduledPosts();
  }, [currentDate, viewMode, weekStart]);

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

  useEffect(() => {
    if (!showInspiration) return;
    fetchInspirationRange();
  }, [currentDate, viewMode, showInspiration]);

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

  const fetchScheduledPosts = async () => {
    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      
      // Compute date range based on view mode
      const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const startOfWeekLocal = (d: Date) => { const s = new Date(d); const dow = s.getDay(); const startIdx = weekStart === 'monday' ? 1 : 0; const diff = (dow - startIdx + 7) % 7; s.setDate(s.getDate() - diff); return startOfDay(s); };
      const endOfWeekLocal = (d: Date) => {
        const s = startOfWeekLocal(d);
        const e = new Date(s);
        e.setDate(s.getDate() + 6);
        return endOfDay(e);
      };
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      let rangeStart: Date;
      let rangeEnd: Date;
      if (viewMode === 'day') {
        rangeStart = startOfDay(currentDate);
        rangeEnd = endOfDay(currentDate);
      } else if (viewMode === 'week') {
        rangeStart = startOfWeekLocal(currentDate);
        rangeEnd = endOfWeekLocal(currentDate);
      } else if (viewMode === 'list') {
        // Rolling next 30 days window
        rangeStart = startOfDay(new Date());
        const plus30 = new Date();
        plus30.setDate(plus30.getDate() + 30);
        rangeEnd = endOfDay(plus30);
      } else {
        rangeStart = startOfDay(startOfMonth);
        rangeEnd = endOfDay(endOfMonth);
      }

      // Get current user's tenant_id first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("No authenticated user found");
        return;
      }

      const { data: userData } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();
      let tenantId = userData?.tenant_id as string | null | undefined;
      if (!tenantId) {
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (membership?.tenant_id) {
          tenantId = membership.tenant_id as string;
          await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id);
        }
      }
      if (!tenantId) {
        setError('No tenant found for user');
        return;
      }

    // Fetch campaign posts that have a scheduled_for within range
    const { data: campaignPosts, error: postsError } = await supabase
      .from("campaign_posts")
      .select(`
        id,
        content,
        scheduled_for,
        status,
        approval_status,
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
      .eq("tenant_id", tenantId)
      .not("scheduled_for", "is", null)
      .gte("scheduled_for", rangeStart.toISOString())
      .lte("scheduled_for", rangeEnd.toISOString())
      .order("scheduled_for");
    
    if (postsError) {
      console.error('Error fetching campaign posts:', postsError);
      console.error('Query details:', { 
        tenant_id: userData?.tenant_id, 
        startOfMonth: startOfMonth.toISOString(), 
        endOfMonth: endOfMonth.toISOString() 
      });
    } else {
      console.log('Successfully fetched campaign posts:', campaignPosts?.length || 0);
    }

    // Map base posts (with scheduled_for on campaign_posts)
    const basePosts: ScheduledPost[] = (campaignPosts || []).map((post: any) => {
      const campaign = Array.isArray(post.campaign) ? post.campaign[0] : post.campaign;
      return {
        ...post,
        campaign,
        scheduled_for: post.scheduled_for || campaign?.event_date,
        media_assets: Array.isArray(post.media_assets) && post.media_assets.length > 0 
          ? (post.media_assets as any[])
          : post.media_assets || []
      } as ScheduledPost;
    });

    // Also fetch scheduled items from publishing_queue for posts that don't have scheduled_for on campaign_posts
    const { data: queueItems, error: queueErr } = await supabase
      .from('publishing_queue')
      .select(`
        id,
        scheduled_for,
        campaign_posts!inner (
          id,
          content,
          tenant_id,
          status,
          approval_status,
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
        )
      `)
      .eq('campaign_posts.tenant_id', tenantId)
      .gte('scheduled_for', rangeStart.toISOString())
      .lte('scheduled_for', rangeEnd.toISOString())
      .order('scheduled_for', { ascending: true });

    if (queueErr) {
      console.warn('Queue fetch for calendar failed:', queueErr);
    }

    // Merge: prefer campaign_posts.scheduled_for when present; otherwise use queue scheduled_for
    const byPostId = new Map<string, ScheduledPost>();
    for (const p of basePosts) {
      byPostId.set(p.id, p);
    }
    for (const q of queueItems || []) {
      const cp = Array.isArray(q.campaign_posts) ? q.campaign_posts[0] : q.campaign_posts;
      if (!cp) continue;
      if (!byPostId.has(cp.id)) {
        const campaign = Array.isArray(cp.campaign) ? cp.campaign[0] : cp.campaign;
        byPostId.set(cp.id, {
          id: cp.id,
          content: cp.content,
          platform: cp.platform,
          platforms: Array.isArray(cp.platforms) ? cp.platforms : (cp.platform ? [cp.platform] : []),
          scheduled_for: q.scheduled_for,
          status: cp.status,
          approval_status: cp.approval_status,
          is_quick_post: cp.is_quick_post,
          media_url: cp.media_url,
          media_assets: Array.isArray(cp.media_assets) ? cp.media_assets : [],
          campaign,
        });
      }
    }

    const allPosts = Array.from(byPostId.values());
    console.log('Calendar widget - fetched posts:', allPosts.length, 'for range:', rangeStart.toISOString(), '→', rangeEnd.toISOString());
    setScheduledPosts(allPosts.sort((a, b) => sortByDate(a, b)));
    } catch (error) {
      console.error('Error in fetchScheduledPosts:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Helper to compute current range and fetch inspiration
  const fetchInspirationRange = async () => {
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
  };

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

  const updatePrefs = async (next: { show_sports?: boolean; show_alcohol?: boolean }) => {
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
  }

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
            <div className="text-xs font-semibold text-text-secondary mb-1">Summary</div>
            <div className="text-sm">{p.summary}</div>
          </div>
        )}
        {p.why && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-1">Why it matters</div>
            <div className="text-sm">{p.why}</div>
          </div>
        )}
        {!!(p.activation && p.activation.length) && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-1">Activation ideas</div>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {p.activation!.map((it, i) => <li key={`act-${i}`}>{it}</li>)}
            </ul>
          </div>
        )}
        {!!(p.angles && p.angles.length) && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-1">Content angles</div>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {p.angles!.map((it, i) => <li key={`ang-${i}`}>{it}</li>)}
            </ul>
          </div>
        )}
        {!!(p.assets && p.assets.length) && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-1">Asset brief</div>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {p.assets!.map((it, i) => <li key={`ast-${i}`}>{it}</li>)}
            </ul>
          </div>
        )}
        {!!(p.hashtags && p.hashtags.length) && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-1">Hashtags</div>
            <div className="flex flex-wrap gap-1">
              {p.hashtags!.map((t, i) => (
                <span key={`tag-${i}`} className="text-xs bg-muted px-2 py-0.5 rounded-soft border border-border">{t}</span>
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

  const getPostsForDate = (date: Date) => {
    return scheduledPosts.filter(p => {
      if (!p.scheduled_for) return false;
      const d = new Date(p.scheduled_for);
      return sameDay(d, date);
    }).sort((a, b) => sortByDate(a, b));
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

  // Shared renderer for post preview snippets
  const renderPostPreview = (post: ScheduledPost, mode: 'compact' | 'full' = 'compact') => {
    const tz = getUserTimeZone();
    const isDraft = post.status === "draft" || post.campaign?.status === "draft";
    const time = post.scheduled_for ? formatTime(post.scheduled_for, tz) : "draft";
    const label = post.is_quick_post ? "Quick" : post.campaign?.name || "Post";
    const platforms = post.platforms || (post.platform ? [post.platform] : []);
    const thumbnailUrl = post.media_url || (post.media_assets && post.media_assets.length > 0 ? post.media_assets[0].file_url : null);
    const contentPreview = post.content ? post.content.substring(0, mode === 'full' ? 200 : 60) + ((post.content.length > (mode === 'full' ? 200 : 60)) ? "..." : "") : "";
    const appr = (post.approval_status || 'pending');

    return (
      <div
        key={post.id}
        onClick={(e) => handlePostEdit(post, e as any)}
        className={`text-xs rounded-soft overflow-hidden cursor-pointer hover:opacity-80 transition-opacity ${
          isDraft ? "bg-yellow-50 border border-yellow-200" : "bg-primary/5 border border-primary/20"
        }`}
        title={`${label}${contentPreview ? `: ${contentPreview}` : ''} - ${platforms.length ? platforms.join(', ') : 'No platforms'} - Click to edit`}
      >
        <div className="flex items-start gap-2 p-2">
          {thumbnailUrl && (
            <div className={`${mode === 'full' ? 'w-12 h-12' : 'w-8 h-8'} relative bg-gray-100 rounded-soft overflow-hidden flex-shrink-0`}>
              <Image src={thumbnailUrl} alt="Post thumbnail" fill className="object-cover" sizes={mode === 'full' ? '48px' : '32px'} onError={(e) => { (e.currentTarget as any).style.display = 'none'; }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className={`font-medium truncate ${isDraft ? "text-yellow-900" : "text-primary"}`}>
              {isDraft ? "📝" : "📅"} {time}
            </div>
            {/* Approval badge */}
            <div className="mt-0.5">
              {appr === 'approved' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-200">Approved</span>
              )}
              {appr === 'pending' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-200">Pending</span>
              )}
              {appr === 'rejected' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">Rejected</span>
              )}
            </div>
            {contentPreview && (
              <div className={`text-[11px] whitespace-pre-wrap text-gray-700 mt-0.5`}>{contentPreview}</div>
            )}
            {platforms.length > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {platforms.slice(0, mode === 'full' ? 5 : 3).map((platform, idx) => (
                  <PlatformBadge key={`${post.id}-${platform}-${idx}`} platform={platform} size={mode === 'full' ? 'md' : 'sm'} showLabel={mode === 'full'} className={mode === 'full' ? '' : 'w-4 h-4 p-0.5'} />
                ))}
                {platforms.length > (mode === 'full' ? 5 : 3) && (
                  <span className="text-[10px] text-gray-500 ml-1">+{platforms.length - (mode === 'full' ? 5 : 3)}</span>
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
    <div className="w-full rounded-lg border bg-card text-card-foreground shadow-sm p-4">
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
        <div className="inline-flex rounded-medium border border-border overflow-hidden overflow-x-auto">
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
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-surface rounded-medium transition-colors"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5" />
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
          className="p-2 hover:bg-surface rounded-medium transition-colors"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      {/* Inspiration + Prefs */}
      <div className="mb-2 flex items-center gap-4 flex-wrap">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="w-4 h-4" checked={showInspiration} onChange={(e) => setShowInspiration(e.target.checked)} />
          <span className="flex items-center gap-1"><Lightbulb className="w-4 h-4 text-amber-500"/> Inspiration overlay {inspoLoading && <span className="text-text-secondary">(loading…)</span>}</span>
        </label>
        <div className="flex items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="w-4 h-4" checked={showSports} disabled={prefsLoading} onChange={(e) => { setShowSports(e.target.checked); updatePrefs({ show_sports: e.target.checked }) }} />
            <span>Sports</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="w-4 h-4" checked={showAlcohol} disabled={prefsLoading} onChange={(e) => { setShowAlcohol(e.target.checked); updatePrefs({ show_alcohol: e.target.checked }) }} />
            <span>Alcohol</span>
          </label>
        </div>
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

      {/* Month View */}
      {viewMode === 'month' && (
      <div className={`w-full grid grid-cols-7 gap-1 ${loading ? 'opacity-50' : ''}`}>
        {/* Day headers */}
        {days.map(day => (
          <div key={day} className="text-center text-xs font-semibold text-text-secondary py-2">
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
          const hasQuickPosts = postsForDay.some(p => p.is_quick_post);

          return (
            <div
              key={day}
              onClick={() => handleDayClick(day, postsForDay)}
              className={`
                min-h-[100px] p-1 border border-border rounded-soft cursor-pointer hover:border-primary/50 transition-colors flex flex-col
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
              {showInspiration && inspoForDate(day).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {inspoForDate(day).map((ii, idx) => (
                    <button
                      key={`${ii.date}-${idx}`}
                      onClick={(e) => { e.stopPropagation(); setInspoSelected({ date: ii.date, event_id: ii.event_id, name: ii.name, category: ii.category, brief: ii.brief }); setInspoDialogOpen(true); }}
                      className={`text-[10px] px-2 py-0.5 rounded-md border ${categoryColor(ii.category)} hover:opacity-90`}
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
            </div>
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
            <div className="min-w-[720px] w-full grid grid-cols-[64px_repeat(7,1fr)] gap-2">
              {/* Header row */}
              <div></div>
              {dates.map((d, i) => (
                <div key={`wh-${i}`} className="text-xs font-semibold text-center text-text-secondary">
                  {formatDate(d, undefined, { weekday: 'short' })} {d.getDate()}
                </div>
              ))}
              {/* Hours rows */}
              {hours.map((h) => (
                <div className="contents" key={`w-row-${h}`}>
                  <div className="text-[10px] text-text-secondary pr-1 text-right leading-5">
                    {formatTime(new Date(2000,0,1,h), getUserTimeZone())}
                  </div>
                  {dates.map((d, i) => (
                    <div key={`wc-${h}-${i}`} className="min-h-10 border border-border rounded-soft p-1 bg-white">
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
          <div className="border rounded-medium p-0 bg-white overflow-hidden">
            <div className="grid grid-cols-[64px_1fr]">
              {hours.map(h => (
                <div className="contents" key={`d-row-${h}`}>
                  <div className="text-[10px] text-text-secondary text-right pr-2 py-2 border-b border-border">
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
          setSelectedIds(prev => {
            if (allSelected) return new Set();
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
            fetchScheduledPosts();
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
            fetchScheduledPosts();
            if (successCount > 0) toast.success(`Deleted ${successCount} post${successCount !== 1 ? 's' : ''}`);
          } finally {
            setBulkDeleting(false);
          }
        };

        return (
          <div className="border rounded-medium bg-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 border-b border-border">
              <div className="flex items-center gap-3">
                <input type="checkbox" className="w-4 h-4" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                <span className="text-sm text-text-secondary">{filtered.length} scheduled</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-between sm:justify-end">
                {/* Approval filter */}
                <div className="flex items-center gap-1 text-sm flex-wrap">
                  <span className="text-text-secondary">Approval:</span>
                  {(['all','pending','approved','rejected'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setApprovalFilter(f)}
                      className={`px-2 py-1 rounded-md border ${approvalFilter===f ? 'bg-primary text-white border-primary' : 'border-input hover:bg-muted'}`}
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
                  const thumb = (p as any).media_url || ((p as any).media_assets && (p as any).media_assets[0]?.file_url);
                  const selected = selectedIds.has(p.id);
                  const appr = (p.approval_status || 'pending');
                  return (
                    <li key={p.id} className="p-3 flex items-center gap-3">
                      <input type="checkbox" className="w-4 h-4" checked={selected} onChange={() => toggleSelect(p.id)} aria-label="Select post" />
                      <div className="w-12 h-12 rounded-soft overflow-hidden bg-gray-100 flex-shrink-0 relative">
                        {thumb ? <Image src={thumb} alt="" fill sizes="48px" className="object-cover" /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.content?.slice(0, 120) || '(No content)'}{p.content && p.content.length > 120 ? '…' : ''}</div>
                        <div className="text-xs text-text-secondary mt-0.5">{t}</div>
                        {platforms.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            {platforms.slice(0,5).map((pf, i) => (
                              <PlatformBadge key={`${p.id}-${pf}-${i}`} platform={pf} size="sm" showLabel={false} />
                            ))}
                          </div>
                        )}
                        {/* Approval badge */}
                        <div className="mt-1">
                          {appr === 'approved' && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-green-100 text-green-800 border border-green-200">
                              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M9 16.17l-3.88-3.88-1.41 1.41L9 19 20.29 7.71l-1.41-1.41z"></path></svg>
                              Approved
                            </span>
                          )}
                          {appr === 'pending' && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-yellow-100 text-yellow-800 border border-yellow-200">
                              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M12 7v5l4 2"></path></svg>
                              Pending
                            </span>
                          )}
                          {appr === 'rejected' && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-200">
                              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M18.3 5.71L12 12.01 5.7 5.7 4.29 7.11l6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.29 6.3 1.42-1.41-6.3-6.3 6.3-6.29z"></path></svg>
                              Rejected
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.preventDefault(); handlePostEdit(p, e as any); }} className="border border-input rounded-md px-3 py-1.5 text-sm">Edit</button>
                        <button onClick={() => handleInlineDelete(p.id)} className="text-red-600 text-sm hover:bg-red-50 rounded-md px-3 py-1.5">Delete</button>
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
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-secondary" />
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
        <DialogContent aria-describedby={undefined} className="sm:max-w-3xl p-0">
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
                  className="text-sm text-text-secondary hover:text-foreground"
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
