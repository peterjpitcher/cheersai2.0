"use client";

import { ScheduledPostRecord } from "@/lib/hooks/useScheduledPosts";
import { formatDate, formatTime, getUserTimeZone } from "@/lib/datetime";
import PlatformBadge from "@/components/ui/platform-badge";

export default function WeekGrid({
  date,
  posts,
}: {
  date: Date;
  posts: ScheduledPostRecord[];
}) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const startOfWeek = (d: Date) => { const s = new Date(d); const dow = s.getDay(); s.setDate(s.getDate() - dow); return startOfDay(s); };
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
          <div key={idx} className="border rounded-lg">
            <div className={`p-2 text-center font-semibold ${isToday ? 'bg-primary text-white' : 'bg-surface'}`}>
              <div className="text-sm">{formatDate(d, undefined, { weekday: 'short' })}</div>
              <div className="text-lg">{d.getDate()}</div>
            </div>
            <div className="p-2 space-y-2 min-h-[360px]">
              {list.map((p) => (
                <div key={p.id} className="p-2 border rounded-soft bg-background">
                  <div className="text-xs text-text-secondary mb-1">{formatTime(p.scheduled_for!, tz)}</div>
                  <div className="font-medium text-sm mb-1 truncate">{p.campaign?.name || 'Quick Post'}</div>
                  <div className="text-xs text-text-secondary line-clamp-2 mb-2">{p.content}</div>
                  <div className="flex gap-1">
                    {(p.platforms || []).map((pl, i2) => (
                      <PlatformBadge key={`${p.id}-${pl}-${i2}`} platform={pl} size="sm" />
                    ))}
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <p className="text-xs text-text-secondary italic">No posts</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

