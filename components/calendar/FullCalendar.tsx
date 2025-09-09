"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/datetime";
import { useScheduledPosts, CalendarMode } from "@/lib/hooks/useScheduledPosts";
import { useWeekStart } from "@/lib/hooks/useWeekStart";
import MonthGrid from "@/components/calendar/MonthGrid";
import WeekGrid from "@/components/calendar/WeekGrid";
import DayTimeline from "@/components/calendar/DayTimeline";
import ListView from "@/components/calendar/ListView";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CalendarFilters {
  platforms?: string[]; // allowed platforms; if empty or undefined, no filter
  approval?: 'all'|'pending'|'approved'|'rejected';
  status?: 'all'|'scheduled'|'published'|'failed';
}

export default function FullCalendar({ filters }: { filters?: CalendarFilters }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [mode, setMode] = useState<CalendarMode>("month");
  const { weekStart, index: weekStartIndex } = useWeekStart();
  const { posts, loading, error } = useScheduledPosts(currentDate, mode, weekStart);
  const filteredPosts = posts.filter(p => {
    // status filter
    if (filters?.status && filters.status !== 'all') {
      if ((p.status || 'scheduled') !== filters.status) return false;
    }
    // approval filter
    if (filters?.approval && filters.approval !== 'all') {
      if ((p.approval_status || 'pending') !== filters.approval) return false;
    }
    // platforms filter
    if (filters?.platforms && filters.platforms.length > 0) {
      const pl = (p.platforms || []) as string[];
      if (!pl.some(v => filters.platforms!.includes(v))) return false;
    }
    return true;
  });

  const prev = () => {
    const d = new Date(currentDate);
    if (mode === "month") d.setMonth(d.getMonth() - 1);
    else if (mode === "week") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };
  const next = () => {
    const d = new Date(currentDate);
    if (mode === "month") d.setMonth(d.getMonth() + 1);
    else if (mode === "week") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };
  const today = () => setCurrentDate(new Date());

  useEffect(() => {
    // When changing mode, snap date to today for better UX in list/day
    if (mode === "day" || mode === "list") setCurrentDate(new Date());
  }, [mode]);

  useEffect(() => {
    // Page-view instrumentation for calendar view usage
    try {
      const body = JSON.stringify({ name: 'ui.page_view', tags: { path: '/publishing/queue', view: 'calendar' } })
      navigator.sendBeacon?.('/api/metrics/event', body) || fetch('/api/metrics/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    } catch {}
    // fire once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-2 hover:bg-surface rounded-medium" aria-label="Previous">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={today} className="px-3 py-1.5 border rounded-medium text-sm">Today</button>
          <button onClick={next} className="p-2 hover:bg-surface rounded-medium" aria-label="Next">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="font-semibold">
          {mode === 'month' && formatDate(currentDate, undefined, { month: 'long', year: 'numeric' })}
          {mode === 'week' && (() => {
            const startOfWeek = (date: Date) => { const d = new Date(date); const dow = d.getDay(); const diff = (dow - weekStartIndex + 7) % 7; d.setDate(d.getDate() - diff); return d; };
            const s = startOfWeek(currentDate);
            const e = new Date(s); e.setDate(s.getDate() + 6);
            const fmt = (d: Date) => formatDate(d, undefined, { day: 'numeric', month: 'short' });
            return `Week of ${fmt(s)} – ${fmt(e)}`;
          })()}
          {mode === 'day' && formatDate(currentDate, undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          {mode === 'list' && 'Scheduled (next 30 days)'}
        </div>
        <div className="inline-flex rounded-medium border border-border overflow-hidden">
          {(['day','week','month','list'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-sm transition-colors ${mode === m ? 'bg-primary text-white' : 'bg-background hover:bg-surface'} ${m !== 'day' ? 'border-l border-border' : ''}`}
              aria-pressed={mode === m}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-medium text-sm text-red-700">{error}</div>
      )}
      {loading ? (
        <div className="p-8 text-center text-text-secondary">Loading…</div>
      ) : (
        <div className="mt-2">
          {mode === 'month' && <MonthGrid date={currentDate} posts={filteredPosts} weekStart={weekStart} />} 
          {mode === 'week' && <WeekGrid date={currentDate} posts={filteredPosts} weekStart={weekStart} />} 
          {mode === 'day' && <DayTimeline date={currentDate} posts={filteredPosts} />} 
          {mode === 'list' && <ListView posts={filteredPosts} />} 
        </div>
      )}
    </div>
  );
}
