"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type CalendarMode = "day" | "week" | "month" | "list";

export interface ScheduledPostRecord {
  id: string;
  content: string;
  scheduled_for?: string;
  status?: string;
  approval_status?: "pending" | "approved" | "rejected";
  is_quick_post?: boolean;
  platform?: string | null;
  platforms?: string[] | null;
  media_url?: string | null;
  media_assets?: Array<{ id: string; file_url: string; alt_text?: string | null }> | null;
  campaign?: {
    id: string;
    name: string;
    status: string;
    event_date?: string | null;
  } | null;
}

export function useScheduledPosts(currentDate: Date, mode: CalendarMode, weekStart: 'sunday'|'monday' = 'monday') {
  const [posts, setPosts] = useState<ScheduledPostRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const startOfWeekLocal = (d: Date) => { const s = new Date(d); const dow = s.getDay(); const startIdx = weekStart === 'monday' ? 1 : 0; const diff = (dow - startIdx + 7) % 7; s.setDate(s.getDate() - diff); return startOfDay(s); };
    const endOfWeekLocal = (d: Date) => { const s = startOfWeekLocal(d); const e = new Date(s); e.setDate(s.getDate() + 6); return endOfDay(e); };

    if (mode === "day") {
      return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
    }
    if (mode === "week") {
      return { start: startOfWeekLocal(currentDate), end: endOfWeekLocal(currentDate) };
    }
    if (mode === "list") {
      const start = startOfDay(new Date());
      const plus30 = new Date();
      plus30.setDate(plus30.getDate() + 30);
      return { start, end: endOfDay(plus30) };
    }
    // month
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }, [currentDate, mode, weekStart]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        // Fetch via server API to avoid client-side RLS issues
        const params = new URLSearchParams({ from: range.start.toISOString(), to: range.end.toISOString() })
        const resp = await fetch(`/api/calendar/posts?${params.toString()}`, { credentials: 'include' })
        if (!resp.ok) {
          setError(`Failed to load posts (${resp.status})`)
          setPosts([])
        } else {
          const json = await resp.json().catch(() => ({}))
          const items = Array.isArray(json?.data?.items) ? json.data.items : (Array.isArray(json?.items) ? json.items : [])
          const normalized: ScheduledPostRecord[] = (items || []).map((p: any) => ({
            ...p,
            platforms: Array.isArray(p.platforms) && p.platforms.length > 0 ? p.platforms : (p.platform ? [p.platform] : []),
            media_assets: Array.isArray(p.media_assets) ? p.media_assets : [],
          }))
          if (!cancelled) setPosts(normalized)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [range.start, range.end]);

  return { posts, loading, error, range } as const;
}
