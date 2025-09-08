"use client";

import { ScheduledPostRecord } from "@/lib/hooks/useScheduledPosts";
import { formatDate } from "@/lib/datetime";
import PlatformBadge from "@/components/ui/platform-badge";

export default function MonthGrid({
  date,
  posts,
}: {
  date: Date;
  posts: ScheduledPostRecord[];
}) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());

  const days: Date[] = [];
  const iter = new Date(startDate);
  while (iter <= lastDay || iter.getDay() !== 0) {
    days.push(new Date(iter));
    iter.setDate(iter.getDate() + 1);
  }

  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const postsFor = (d: Date) => posts.filter(p => p.scheduled_for && sameDay(new Date(p.scheduled_for), d));

  return (
    <div className="grid grid-cols-7 gap-1">
      {(() => {
        const base = new Date(2000, 0, 2);
        return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86400000)).map((d, idx) => (
          <div key={idx} className="text-center font-semibold p-2 text-sm text-text-secondary">
            {formatDate(d, undefined, { weekday: 'short' })}
          </div>
        ));
      })()}
      {days.map((d, i) => {
        const inMonth = d.getMonth() === date.getMonth();
        const isToday = d.toDateString() === new Date().toDateString();
        const dayPosts = postsFor(d);
        return (
          <div
            key={`${d.toISOString()}-${i}`}
            className={`min-h-[110px] p-2 border rounded-lg ${inMonth ? 'bg-white' : 'bg-surface'} ${isToday ? 'ring-2 ring-primary' : ''}`}
          >
            <div className="font-semibold text-sm mb-1">{d.getDate()}</div>
            <div className="space-y-1">
              {dayPosts.map((p) => (
                <div key={p.id} className="text-[11px] p-1 rounded bg-gray-50 border border-border/50 truncate" title={p.content}>
                  <div className="flex items-center gap-1">
                    <span className="truncate">{p.campaign?.name || 'Quick Post'}</span>
                    {(p.platforms || []).slice(0,2).map((platform, idx2) => (
                      <PlatformBadge key={`${p.id}-${platform}-${idx2}`} platform={platform} size="sm" className="ml-auto" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

