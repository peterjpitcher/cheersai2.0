'use client';

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Send,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { useToast } from '@/components/providers/toast-provider';
import { getScheduledContentAction, scheduleContent, approveForQueue, saveDraft } from '@/app/actions/content';
import { detectConflicts, type Conflict } from '@/lib/scheduling/conflicts';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { Platform, PlatformCopy, ContentItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEZONE = 'Europe/London';

const CONTENT_TYPE_LABELS: Record<string, string> = {
  instant_post: 'Instant Post',
  story: 'Story',
  event: 'Event',
  promotion: 'Promotion',
  weekly_recurring: 'Weekly Recurring',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScheduleStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  generatedCopy: PlatformCopy | null;
  selectedMediaIds: string[];
  onConfirm: () => void;
  isSubmitting: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 4: Schedule and confirm.
 *
 * Shows a complete content summary, date/time picker for scheduling,
 * conflict detection warnings (SCHED-02), and confirm/schedule actions.
 * All times displayed in Europe/London timezone.
 */
export function ScheduleStep({
  contentId,
  contentBrief,
  generatedCopy,
  selectedMediaIds,
  onConfirm,
  isSubmitting,
}: ScheduleStepProps): React.JSX.Element {
  const [scheduledDate, setScheduledDate] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const toast = useToast();

  const platforms = (contentBrief.platforms ?? []) as Platform[];

  const isInstantNow =
    contentBrief.contentType === 'instant_post' &&
    'publishMode' in contentBrief &&
    contentBrief.publishMode === 'now';

  // -----------------------------------------------------------------------
  // Conflict detection on date change
  // -----------------------------------------------------------------------

  const checkConflicts = useCallback(async (dateValue: string) => {
    if (!dateValue || !contentId) {
      setConflicts([]);
      return;
    }

    setIsCheckingConflicts(true);
    try {
      // Build a 6-hour window around the selected time
      const selectedDt = DateTime.fromISO(dateValue, { zone: DEFAULT_TIMEZONE });
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

  // Check conflicts when date changes
  useEffect(() => {
    if (scheduledDate) {
      void checkConflicts(scheduledDate);
    } else {
      setConflicts([]);
    }
  }, [scheduledDate, checkConflicts]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleSaveDraft = useCallback(async () => {
    if (!contentId) return;
    setIsSavingDraft(true);
    try {
      const result = await saveDraft(contentId, {
        step: 3,
        contentType: contentBrief.contentType,
        brief: contentBrief,
        generatedCopy: generatedCopy ?? undefined,
        selectedMediaIds: selectedMediaIds.length > 0 ? selectedMediaIds : undefined,
      });
      if (result.error) {
        toast.error('Failed to save draft', { description: result.error });
      } else {
        toast.success('Draft saved');
        onConfirm();
      }
    } finally {
      setIsSavingDraft(false);
    }
  }, [contentId, contentBrief, generatedCopy, selectedMediaIds, toast, onConfirm]);

  const handleSchedule = useCallback(async () => {
    if (!contentId || !scheduledDate) return;

    // Validate date is in the future
    const selectedDt = DateTime.fromISO(scheduledDate, { zone: DEFAULT_TIMEZONE });
    if (selectedDt <= DateTime.now().setZone(DEFAULT_TIMEZONE)) {
      toast.error('Schedule date must be in the future');
      return;
    }

    setIsScheduling(true);
    try {
      const result = await scheduleContent(contentId, selectedDt.toISO()!);
      if (result.error) {
        toast.error('Failed to schedule', { description: result.error });
      } else {
        toast.success('Content scheduled', {
          description: `Scheduled for ${selectedDt.toFormat('dd MMM yyyy, HH:mm')} (${DEFAULT_TIMEZONE})`,
        });
        onConfirm();
      }
    } finally {
      setIsScheduling(false);
    }
  }, [contentId, scheduledDate, toast, onConfirm]);

  const handleQueueNow = useCallback(async () => {
    if (!contentId) return;
    setIsQueueing(true);
    try {
      const result = await approveForQueue(contentId);
      if (result.error) {
        toast.error('Failed to queue', { description: result.error });
      } else {
        toast.success('Content queued for publishing');
        onConfirm();
      }
    } finally {
      setIsQueueing(false);
    }
  }, [contentId, toast, onConfirm]);

  const isBusy = isSubmitting || isSavingDraft || isScheduling || isQueueing;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Review & Schedule</h3>
        <p className="text-sm text-muted-foreground">
          Check the details below and confirm when ready.
        </p>
      </div>

      {/* Content summary card */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Type</span>
          <span className="text-sm font-medium text-foreground">
            {CONTENT_TYPE_LABELS[contentBrief.contentType] ?? contentBrief.contentType}
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

        {/* Generated copy preview */}
        {generatedCopy && (
          <div className="space-y-1 border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium text-muted-foreground">Generated Copy</span>
            </div>
            <div className="space-y-1">
              {platforms.map((p) => {
                const copy = generatedCopy[p];
                if (!copy) return null;
                return (
                  <p key={p} className="text-xs text-foreground/80 line-clamp-2">
                    <span className="font-medium capitalize">{p}:</span>{' '}
                    {copy.body.slice(0, 120)}{copy.body.length > 120 ? '...' : ''}
                  </p>
                );
              })}
            </div>
          </div>
        )}

        {/* Attached media */}
        {selectedMediaIds.length > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <ImageIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium text-muted-foreground">Media</span>
            </div>
            <span className="text-sm text-foreground">
              {selectedMediaIds.length} item{selectedMediaIds.length === 1 ? '' : 's'} attached
            </span>
          </div>
        )}
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
                  className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/30"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-amber-800 dark:text-amber-200">
                      Scheduling conflict: <span className="font-medium">{conflict.itemA.title ?? 'Untitled'}</span> is
                      already scheduled {conflict.gapMinutes} minute{conflict.gapMinutes === 1 ? '' : 's'} away
                      on <span className="font-medium capitalize">{conflict.platform}</span>
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {conflict.suggestion}
                    </p>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Conflicts are warnings only -- you can still proceed with this time.
              </p>
            </div>
          )}

          {scheduledDate && !isCheckingConflicts && conflicts.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              No scheduling conflicts detected
            </div>
          )}
        </div>
      )}

      {/* Scheduled time display */}
      {scheduledDate && !isInstantNow && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
          <span className="text-sm font-medium text-muted-foreground">Scheduled for</span>
          <span className="text-sm font-medium text-foreground">
            {DateTime.fromISO(scheduledDate, { zone: DEFAULT_TIMEZONE }).toFormat('dd MMM yyyy, HH:mm')}{' '}
            <span className="text-xs text-muted-foreground">{DEFAULT_TIMEZONE}</span>
          </span>
        </div>
      )}

      {/* Confirm actions */}
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={handleSaveDraft}
          disabled={isBusy || !contentId}
        >
          {isSavingDraft ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="size-4 mr-1.5" aria-hidden="true" />
          )}
          Save as Draft
        </Button>

        {isInstantNow ? (
          <Button
            type="button"
            onClick={handleQueueNow}
            disabled={isBusy || !contentId}
            size="lg"
          >
            {isQueueing ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4 mr-1.5" aria-hidden="true" />
            )}
            Save and Queue
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSchedule}
            disabled={isBusy || !contentId || !scheduledDate}
            size="lg"
          >
            {isScheduling ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-4 mr-1.5" aria-hidden="true" />
            )}
            Schedule
          </Button>
        )}
      </div>
    </div>
  );
}
