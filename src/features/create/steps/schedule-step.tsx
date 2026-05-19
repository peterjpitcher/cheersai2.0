'use client';

import { useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlatformBadge } from '@/components/ui/platform-badge';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { Platform } from '@/types/content';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScheduleStepProps {
  contentBrief: ContentBrief;
  onConfirm: () => void;
  isSubmitting: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 4: Schedule and confirm.
 *
 * Shows a summary card of the content, date/time picker for scheduling,
 * and confirm button. Conflict detection placeholder for Plan 07.
 */
export function ScheduleStep({
  contentBrief,
  onConfirm,
  isSubmitting,
}: ScheduleStepProps): React.JSX.Element {
  const [scheduledDate, setScheduledDate] = useState('');
  const platforms = (contentBrief.platforms ?? []) as Platform[];

  const isInstantNow =
    contentBrief.contentType === 'instant_post' &&
    'publishMode' in contentBrief &&
    contentBrief.publishMode === 'now';

  const contentTypeLabels: Record<string, string> = {
    instant_post: 'Instant Post',
    story: 'Story',
    event: 'Event',
    promotion: 'Promotion',
    weekly_recurring: 'Weekly Recurring',
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Review & Schedule</h3>
        <p className="text-sm text-muted-foreground">
          Check the details below and confirm when ready.
        </p>
      </div>

      {/* Summary card */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Type</span>
          <span className="text-sm font-medium text-foreground">
            {contentTypeLabels[contentBrief.contentType] ?? contentBrief.contentType}
          </span>
        </div>

        {contentBrief.title && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Title</span>
            <span className="text-sm text-foreground truncate max-w-[60%]">
              {contentBrief.title}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Platforms</span>
          <div className="flex gap-1.5">
            {platforms.map((p) => (
              <PlatformBadge key={p} platform={p} showLabel />
            ))}
          </div>
        </div>
      </div>

      {/* Schedule picker */}
      {!isInstantNow && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="scheduleDate">
              Schedule date and time
            </Label>
            <Input
              id="scheduleDate"
              type="datetime-local"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              All times are in Europe/London timezone.
            </p>
          </div>

          {/* Conflict warning area -- wired in Plan 07 */}
          <div className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
            Conflict detection will be available after scheduling is configured.
          </div>
        </div>
      )}

      {/* Confirm button */}
      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          size="lg"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
          ) : isInstantNow ? (
            <CheckCircle2 className="size-4 mr-1.5" aria-hidden="true" />
          ) : (
            <CalendarClock className="size-4 mr-1.5" aria-hidden="true" />
          )}
          {isInstantNow ? 'Save and Publish Now' : 'Schedule'}
        </Button>
      </div>
    </div>
  );
}
