'use client';

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/providers/toast-provider';
import { getScheduledContentAction } from '@/app/actions/content';
import { detectConflicts, type Conflict } from '@/lib/scheduling/conflicts';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { ContentItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEZONE = 'Europe/London';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScheduleStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  publishMode: 'now' | 'schedule';
  scheduledAt: string | null;
  onPublishModeChange: (mode: 'now' | 'schedule') => void;
  onScheduledAtChange: (iso: string | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 2: Schedule.
 *
 * A controlled, pure scheduling component. Shows "Post now" vs "Schedule"
 * toggle for instant posts, date/time picker, and conflict detection.
 * All times displayed in Europe/London timezone.
 */
export function ScheduleStep({
  contentId,
  contentBrief,
  publishMode,
  scheduledAt,
  onPublishModeChange,
  onScheduledAtChange,
}: ScheduleStepProps): React.JSX.Element {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const toast = useToast();

  // -----------------------------------------------------------------------
  // Conflict detection on scheduledAt change
  // -----------------------------------------------------------------------

  const checkConflicts = useCallback(async (isoDate: string) => {
    if (!isoDate || !contentId) {
      setConflicts([]);
      return;
    }

    setIsCheckingConflicts(true);
    try {
      // Build a 6-hour window around the selected time
      const selectedDt = DateTime.fromISO(isoDate, { zone: DEFAULT_TIMEZONE });
      const windowStart = selectedDt.minus({ hours: 3 }).toISO();
      const windowEnd = selectedDt.plus({ hours: 3 }).toISO();

      if (!windowStart || !windowEnd) {
        setConflicts([]);
        return;
      }

      const result = await getScheduledContentAction(windowStart, windowEnd);
      if (result.data) {
        // Create a temporary item representing the current content
        const currentItem: ContentItem = {
          id: contentId,
          accountId: '',
          contentType: contentBrief.contentType,
          status: 'draft',
          title: contentBrief.title ?? null,
          bodyDraft: { platforms: contentBrief.platforms },
          campaignName: null,
          scheduledAt: selectedDt.toJSDate(),
          eventDate: null,
          eventEndDate: null,
          couponCode: null,
          recurringDayOfWeek: null,
          autoConfirm: false,
          aiGenerationParams: null,
          thumbnailUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Filter out the current item if it exists in results and detect conflicts
        const existingItems = result.data.filter((item) => item.id !== contentId);
        const allItems = [currentItem, ...existingItems];
        const detected = detectConflicts(allItems);
        setConflicts(detected);
      }
    } catch {
      // Silently fail conflict detection -- non-blocking per SCHED-02
      setConflicts([]);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, [contentId, contentBrief]);

  // Check conflicts when scheduledAt changes
  useEffect(() => {
    if (scheduledAt) {
      void checkConflicts(scheduledAt);
    } else {
      setConflicts([]);
    }
  }, [scheduledAt, checkConflicts]);

  // Suppress unused variable -- toast is available for future conflict UX
  void toast;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Schedule</h3>
        <p className="text-sm text-muted-foreground">
          Choose when to publish your content.
        </p>
      </div>

      {/* Publish mode toggle for instant posts */}
      {contentBrief.contentType === 'instant_post' && (
        <div className="space-y-3">
          <Label>When to publish</Label>
          <div className="flex gap-4" role="radiogroup" aria-label="Publish mode">
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                publishMode === 'now'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-ring/40'
              }`}
            >
              <input
                type="radio"
                value="now"
                checked={publishMode === 'now'}
                onChange={() => {
                  onPublishModeChange('now');
                  onScheduledAtChange(null);
                }}
                className="sr-only"
              />
              Post Now
            </label>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                publishMode === 'schedule'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-ring/40'
              }`}
            >
              <input
                type="radio"
                value="schedule"
                checked={publishMode === 'schedule'}
                onChange={() => onPublishModeChange('schedule')}
                className="sr-only"
              />
              Schedule
            </label>
          </div>
        </div>
      )}

      {/* Date/time picker -- shown when scheduling or for non-instant content */}
      {(publishMode === 'schedule' || contentBrief.contentType !== 'instant_post') && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="scheduleDate">Schedule date and time</Label>
            <Input
              id="scheduleDate"
              type="datetime-local"
              value={scheduledAt
                ? DateTime.fromISO(scheduledAt, { zone: DEFAULT_TIMEZONE }).toFormat("yyyy-MM-dd'T'HH:mm")
                : ''
              }
              onChange={(e) => {
                const val = e.target.value;
                if (!val) {
                  onScheduledAtChange(null);
                  return;
                }
                const dt = DateTime.fromFormat(val, "yyyy-MM-dd'T'HH:mm", { zone: DEFAULT_TIMEZONE });
                if (dt.isValid) {
                  onScheduledAtChange(dt.toISO());
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              All times are in Europe/London (GMT/BST)
            </p>
          </div>

          {/* Conflict detection */}
          {isCheckingConflicts && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Checking for conflicts...
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-2">
              {conflicts.map((conflict, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg p-3 text-sm"
                  style={{ background: 'var(--c-orange-soft)', border: '1px solid var(--c-orange)', borderRadius: 'var(--r-lg)' }}
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--c-orange)' }} aria-hidden="true" />
                  <div className="space-y-1">
                    <p style={{ color: 'var(--c-ink)' }}>
                      Scheduling conflict: <span className="font-medium">{conflict.itemA.title ?? 'Untitled'}</span> is
                      already scheduled {conflict.gapMinutes} minute{conflict.gapMinutes === 1 ? '' : 's'} away
                      on <span className="font-medium capitalize">{conflict.platform}</span>
                    </p>
                    <p className="text-xs" style={{ color: 'var(--c-ink-2)' }}>
                      {conflict.suggestion}
                    </p>
                  </div>
                </div>
              ))}
              <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                Conflicts are warnings only -- you can still proceed with this time.
              </p>
            </div>
          )}

          {scheduledAt && !isCheckingConflicts && conflicts.length === 0 && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--c-status-posted-fg)' }}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              No scheduling conflicts detected
            </div>
          )}
        </div>
      )}

      {/* Scheduled time display */}
      {scheduledAt && publishMode !== 'now' && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium text-muted-foreground">Scheduled for</span>
          </div>
          <span className="text-sm font-medium text-foreground">
            {DateTime.fromISO(scheduledAt, { zone: DEFAULT_TIMEZONE }).toFormat('dd MMM yyyy, HH:mm')}{' '}
            <span className="text-xs text-muted-foreground">{DEFAULT_TIMEZONE}</span>
          </span>
        </div>
      )}
    </div>
  );
}
