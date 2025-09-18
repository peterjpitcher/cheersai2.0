"use client";

import { ScheduledPostRecord } from "@/lib/hooks/useScheduledPosts";
import { formatDate, formatTime, getUserTimeZone } from "@/lib/datetime";
import PlatformBadge from "@/components/ui/platform-badge";

export default function DayTimeline({
  date,
  posts,
}: {
  date: Date;
  posts: ScheduledPostRecord[];
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const tz = getUserTimeZone();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const list = posts.filter(p => p.scheduled_for && sameDay(new Date(p.scheduled_for), date));

  return (
    <div className="rounded-lg border">
      <div className="bg-surface p-4 font-semibold">
        {formatDate(date, undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
      <div className="divide-y">
        {hours.map((h) => {
          const hourPosts = list.filter(p => new Date(p.scheduled_for!).getHours() === h);
          return (
            <div key={h} className="flex">
              <div className="w-20 p-2 text-right text-sm text-text-secondary">
                {String(h).padStart(2, '0')}:00
              </div>
              <div className="min-h-[54px] flex-1 p-2">
                {hourPosts.map((p) => (
                  <div key={p.id} className="mb-2 rounded border bg-background p-3">
                    <div className="mb-2 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.campaign?.name || 'Quick Post'}</div>
                        <div className="text-sm text-text-secondary">{formatTime(p.scheduled_for!, tz)}</div>
                      </div>
                      <div className="ml-2 flex gap-1">
                        {(p.platforms || []).map((pl, i2) => (
                          <PlatformBadge key={`${p.id}-${pl}-${i2}`} platform={pl} size="md" />
                        ))}
                      </div>
                    </div>
                    <div className="text-sm text-text-secondary">{p.content}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

