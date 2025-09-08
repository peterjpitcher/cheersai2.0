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
    <div className="border rounded-lg">
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
              <div className="flex-1 p-2 min-h-[54px]">
                {hourPosts.map((p) => (
                  <div key={p.id} className="p-3 mb-2 rounded border bg-background">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.campaign?.name || 'Quick Post'}</div>
                        <div className="text-sm text-text-secondary">{formatTime(p.scheduled_for!, tz)}</div>
                      </div>
                      <div className="flex gap-1 ml-2">
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

