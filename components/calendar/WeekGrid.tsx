"use client";

import { ScheduledPostRecord } from "@/lib/hooks/useScheduledPosts";
import { formatDate, formatTime, getUserTimeZone } from "@/lib/datetime";
import PlatformBadge from "@/components/ui/platform-badge";

export default function WeekGrid({
  date,
  posts,
  weekStart = 'monday',
}: {
  date: Date;
  posts: ScheduledPostRecord[];
  weekStart?: 'sunday'|'monday';
}) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const startOfWeek = (d: Date) => { const s = new Date(d); const dow = s.getDay(); const startIdx = weekStart === 'monday' ? 1 : 0; const diff = (dow - startIdx + 7) % 7; s.setDate(s.getDate() - diff); return startOfDay(s); };
  const tz = getUserTimeZone();
  const s = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });

  const postsForDay = (d: Date) => {
    const start = startOfDay(d); const end = endOfDay(d);
    return posts.filter(p => p.scheduled_for && new Date(p.scheduled_for) >= start && new Date(p.scheduled_for) <= end);
  };

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d, idx) => {
        const isToday = d.toDateString() === new Date().toDateString();
        const list = postsForDay(d);
        return (
          <div key={idx} className="rounded-lg border">
            <div className={`p-2 text-center font-semibold ${isToday ? 'bg-primary text-white' : 'bg-surface'}`}>
              <div className="text-sm">{formatDate(d, undefined, { weekday: 'short' })}</div>
              <div className="text-lg">{d.getDate()}</div>
            </div>
            <div className="min-h-[360px] space-y-2 p-2">
              {list.map((p) => (
                <div key={p.id} className="rounded-soft border bg-background p-2">
                  <div className="mb-1 text-xs text-text-secondary">{formatTime(p.scheduled_for!, tz)}</div>
                  <div className="mb-1 truncate text-sm font-medium">{p.campaign?.name || 'Quick Post'}</div>
                  <div className="mb-2 line-clamp-2 text-xs text-text-secondary">{p.content}</div>
                  <div className="flex gap-1">
                    {(p.platforms || []).map((pl, i2) => (
                      <PlatformBadge key={`${p.id}-${pl}-${i2}`} platform={pl} size="sm" />
                    ))}
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <p className="text-xs italic text-text-secondary">No posts</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
