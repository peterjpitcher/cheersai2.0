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
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setPosts([]); return; }

        // Fetch tenant_id
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
        if (!tenantId) { setError('Failed to resolve tenant'); return; }

        const { data, error } = await supabase
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
          .gte("scheduled_for", range.start.toISOString())
          .lte("scheduled_for", range.end.toISOString())
          .order("scheduled_for");

        if (error) {
          setError(error.message || "Failed to load posts");
          return;
        }

        const base: ScheduledPostRecord[] = (data || []).map((p: any) => ({
          ...p,
          platforms: Array.isArray(p.platforms) && p.platforms.length > 0 ? p.platforms : (p.platform ? [p.platform] : []),
          media_assets: Array.isArray(p.media_assets) ? p.media_assets : [],
        }));

        // Fallback: include items scheduled via publishing_queue when campaign_posts.scheduled_for is null
        const { data: queueItems } = await supabase
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
          .eq('campaign_posts.tenant_id', userData?.tenant_id)
          .gte('scheduled_for', range.start.toISOString())
          .lte('scheduled_for', range.end.toISOString())
          .order('scheduled_for', { ascending: true })

        const byId = new Map<string, ScheduledPostRecord>()
        for (const p of base) byId.set(p.id, p)
        for (const q of (queueItems || []) as any[]) {
          const cp = Array.isArray(q.campaign_posts) ? q.campaign_posts[0] : q.campaign_posts
          if (!cp) continue
          if (!byId.has(cp.id)) {
            byId.set(cp.id, {
              id: cp.id,
              content: cp.content,
              scheduled_for: q.scheduled_for,
              status: cp.status,
              approval_status: cp.approval_status,
              is_quick_post: cp.is_quick_post,
              platform: cp.platform,
              platforms: Array.isArray(cp.platforms) && cp.platforms.length > 0 ? cp.platforms : (cp.platform ? [cp.platform] : []),
              media_url: cp.media_url,
              media_assets: Array.isArray(cp.media_assets) ? cp.media_assets : [],
              campaign: Array.isArray(cp.campaign) ? cp.campaign[0] : cp.campaign,
            })
          }
        }

        const normalized = Array.from(byId.values())
        if (!cancelled) setPosts(normalized);
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
