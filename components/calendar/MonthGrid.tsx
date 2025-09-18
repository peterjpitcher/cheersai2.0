"use client";

import { ScheduledPostRecord } from "@/lib/hooks/useScheduledPosts";
import { formatDate } from "@/lib/datetime";
import PlatformBadge from "@/components/ui/platform-badge";

export default function MonthGrid({
  date,
  posts,
  weekStart = 'monday',
}: {
  date: Date;
  posts: ScheduledPostRecord[];
  weekStart?: 'sunday'|'monday';
}) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const startDate = new Date(firstDay);
  const startIdx = weekStart === 'monday' ? 1 : 0;
  const offset = (firstDay.getDay() - startIdx + 7) % 7;
  startDate.setDate(startDate.getDate() - offset);

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
        const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const ordered = weekStart === 'monday' ? [...labels.slice(1), labels[0]] : labels;
        return ordered.map((name, idx) => (
          <div key={idx} className="p-2 text-center text-sm font-semibold text-text-secondary">{name}</div>
        ));
      })()}
      {days.map((d, i) => {
        const inMonth = d.getMonth() === date.getMonth();
        const isToday = d.toDateString() === new Date().toDateString();
        const dayPosts = postsFor(d);
        return (
          <div
            key={`${d.toISOString()}-${i}`}
            className={`min-h-[110px] rounded-lg border p-2 ${inMonth ? 'bg-white' : 'bg-surface'} ${isToday ? 'ring-2 ring-primary' : ''}`}
          >
            <div className="mb-1 text-sm font-semibold">{d.getDate()}</div>
            <div className="space-y-1">
              {dayPosts.map((p) => (
                <div key={p.id} className="truncate rounded border border-border/50 bg-gray-50 p-1 text-[11px]" title={p.content}>
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
