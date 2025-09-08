"use client";

import { ScheduledPostRecord } from "@/lib/hooks/useScheduledPosts";
import { formatDate, formatDateTime, getUserTimeZone } from "@/lib/datetime";
import PlatformBadge from "@/components/ui/platform-badge";

export default function ListView({ posts }: { posts: ScheduledPostRecord[] }) {
  const tz = getUserTimeZone();
  const grouped = posts.reduce<Record<string, ScheduledPostRecord[]>>((acc, p) => {
    if (!p.scheduled_for) return acc;
    const key = new Date(p.scheduled_for).toISOString().slice(0, 10);
    (acc[key] ||= []).push(p);
    return acc;
  }, {});
  const keys = Object.keys(grouped).sort();

  return (
    <div className="space-y-6">
      {keys.map(k => {
        const d = new Date(k);
        const list = grouped[k].sort((a, b) => new Date(a.scheduled_for || 0).getTime() - new Date(b.scheduled_for || 0).getTime());
        return (
          <div key={k}>
            <div className="text-sm font-semibold text-text-secondary mb-2">{formatDate(d, undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
            <div className="space-y-2">
              {list.map(p => (
                <div key={p.id} className="p-3 rounded border bg-background">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-text-secondary">{formatDateTime(p.scheduled_for!, tz)}</div>
                    <div className="flex gap-1">
                      {(p.platforms || []).map((pl, i2) => (
                        <PlatformBadge key={`${p.id}-${pl}-${i2}`} platform={pl} size="sm" />
                      ))}
                    </div>
                  </div>
                  <div className="font-medium mt-1">{p.campaign?.name || 'Quick Post'}</div>
                  <div className="text-sm text-text-secondary truncate">{p.content}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {keys.length === 0 && (
        <p className="text-sm text-text-secondary">No scheduled posts in this range</p>
      )}
    </div>
  );
}

