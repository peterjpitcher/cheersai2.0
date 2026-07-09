'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DateTime } from 'luxon';

import { Label } from '@/components/ui/label';
import { DEFAULT_TIMEZONE, STORY_POST_TIME } from '@/lib/constants';
import { ScheduleCalendar } from '@/features/create/schedule/schedule-calendar';
import type {
  ExistingPlannerItemDisplay,
  SelectedSlotDisplay,
} from '@/features/create/schedule/schedule-calendar';
import {
  buildEventSuggestions,
  buildPromotionSuggestions,
  buildWeeklyMultiDaySuggestions,
  deconflictSuggestions,
} from '@/features/create/schedule/suggestion-utils';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import { inferSlotLabel } from '@/features/create/schedule/infer-slot-label';
import type { ScheduleSlot } from '@/types/content';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum schedule slots per content item. */
const MAX_SLOTS_DEFAULT = 12;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScheduleStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  publishMode: 'now' | 'schedule';
  selectedSlots: ScheduleSlot[];
  onPublishModeChange: (mode: 'now' | 'schedule') => void;
  onSlotsChange: (slots: ScheduleSlot[]) => void;
  accountId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 2: Schedule.
 *
 * Uses ScheduleCalendar with content-type-aware suggestions, slot management,
 * and existing planner item display. Shows "Post Now" / "Schedule" toggle for
 * instant posts; other content types always show the calendar.
 */
export function ScheduleStep({
  contentId,
  contentBrief,
  publishMode,
  selectedSlots,
  onPublishModeChange,
  onSlotsChange,
  accountId,
}: ScheduleStepProps): React.JSX.Element {
  // Suppress unused — contentId kept in interface for future conflict detection
  void contentId;

  const timezone = DEFAULT_TIMEZONE;
  const today = DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');

  // Weekly recurring seeds the calendar with its derived occurrences, then the
  // user can add/remove/move dates like any other scheduled content type.
  const isWeeklyRecurring = contentBrief.contentType === 'weekly_recurring';

  // -------------------------------------------------------------------------
  // Existing planner items
  // -------------------------------------------------------------------------

  const [existingItems, setExistingItems] = useState<ExistingPlannerItemDisplay[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [calendarWarning, setCalendarWarning] = useState<string | null>(null);
  const fetchedRangesRef = useRef<Set<string>>(new Set());

  const loadExistingItems = useCallback(
    async (monthKey: string) => {
      if (!accountId || fetchedRangesRef.current.has(monthKey)) return;
      fetchedRangesRef.current.add(monthKey);
      setIsLoadingItems(true);
      try {
        // Fetch a 3-month window centred on the requested month
        const centre = DateTime.fromFormat(monthKey, 'yyyy-MM', { zone: timezone });
        if (!centre.isValid) return;
        const rangeStart = centre.minus({ months: 1 }).startOf('month').toISO();
        const rangeEnd = centre.plus({ months: 2 }).endOf('month').toISO();
        if (!rangeStart || !rangeEnd) return;

        const { getCalendarItemsAction } = await import('@/app/actions/content');
        const result = await getCalendarItemsAction(rangeStart, rangeEnd);

        if (result.error) {
          setCalendarWarning('Could not load existing posts. You may accidentally double-book.');
          // Preserve already-loaded months so one failed fetch does not blank the calendar
          fetchedRangesRef.current.delete(monthKey);
        } else {
          setCalendarWarning(null);
          setExistingItems((prev) => {
            const existingIds = new Set(prev.map((i) => i.id));
            const newItems = (result.data ?? []).filter(
              (i: ExistingPlannerItemDisplay) => !existingIds.has(i.id),
            );
            return newItems.length > 0 ? [...prev, ...newItems] : prev;
          });
        }
      } catch {
        setCalendarWarning('Could not load existing posts. You may accidentally double-book.');
        fetchedRangesRef.current.delete(monthKey);
      } finally {
        setIsLoadingItems(false);
      }
    },
    [accountId, timezone],
  );

  // -------------------------------------------------------------------------
  // Initial month derivation
  // -------------------------------------------------------------------------

  const initialMonth = useMemo(() => {
    return DateTime.now().setZone(timezone).toFormat('yyyy-MM');
  }, [timezone]);

  // The calendar fires onMonthChange on mount and on Previous/Next navigation,
  // so each visible month is fetched on demand (no separate mount effect).
  const handleMonthChange = useCallback(
    (monthKey: string) => {
      void loadExistingItems(monthKey);
    },
    [loadExistingItems],
  );

  // -------------------------------------------------------------------------
  // Build suggestions based on content type
  // -------------------------------------------------------------------------

  const rawSuggestions = useMemo(() => {
    if (contentBrief.contentType === 'event') {
      return buildEventSuggestions({
        startDate: contentBrief.eventDate,
        startTime: contentBrief.eventTime,
        timezone,
      });
    }
    if (contentBrief.contentType === 'promotion') {
      return buildPromotionSuggestions({
        endDate: contentBrief.endDate,
        timezone,
      });
    }
    if (contentBrief.contentType === 'weekly_recurring') {
      return buildWeeklyMultiDaySuggestions({
        startDate: today,
        daysOfWeek: contentBrief.daysOfWeek,
        time: contentBrief.time,
        endDate: contentBrief.endDate,
        timezone,
      });
    }
    return [];
  }, [contentBrief, today, timezone]);

  const suggestions = useMemo(() => {
    if (!rawSuggestions.length || !existingItems.length) return rawSuggestions;
    return deconflictSuggestions(
      rawSuggestions,
      existingItems.map((item) => ({
        date:
          DateTime.fromISO(item.scheduledFor, { zone: 'utc' })
            .setZone(timezone)
            .toISODate() ?? '',
      })),
      timezone,
    );
  }, [rawSuggestions, existingItems, timezone]);

  // -------------------------------------------------------------------------
  // Weekly recurring: seed the calendar once, then hand control to the user
  // -------------------------------------------------------------------------
  // Seed the calendar once with every derived occurrence, then hand control to
  // the user. After any manual add/remove we stop re-seeding so edits are not
  // overwritten when the brief is unchanged. Re-seeding resumes only if the
  // derived set itself changes (user went back and edited the brief).
  const weeklySeedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isWeeklyRecurring) return;
    const signature = rawSuggestions.map((s) => `${s.date}:${s.time}`).join('|');
    if (weeklySeedRef.current === signature) return; // already seeded this exact set
    weeklySeedRef.current = signature;
    const desired: ScheduleSlot[] = rawSuggestions.map((s) => ({
      key: `suggestion:${s.id}:${s.date}:${s.time}`,
      date: s.date,
      time: s.time,
      label: s.label,
      source: 'suggestion',
      suggestionId: s.id,
    }));
    onSlotsChange(desired);
  }, [isWeeklyRecurring, rawSuggestions, onSlotsChange]);

  // -------------------------------------------------------------------------
  // Slot management
  // -------------------------------------------------------------------------

  const maxSlots = MAX_SLOTS_DEFAULT;

  const handleAddSlot = useCallback(
    ({ date, time }: { date: string; time: string }) => {
      // Reject past slots
      const candidate = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
      if (!candidate.isValid || candidate < DateTime.now().setZone(timezone)) {
        return;
      }

      // Dedupe check
      const isDuplicate = selectedSlots.some(
        (s) => s.date === date && s.time === time,
      );
      if (isDuplicate) return;

      // Enforce slot limit
      if (selectedSlots.length >= maxSlots) {
        // At limit; ignore additional slots.
        return;
      }

      // Match against suggestions to reattach label/suggestionId
      const matchedSuggestion = suggestions.find(
        (s) => s.date === date && s.time === time,
      );

      const label = matchedSuggestion?.label
        ?? inferSlotLabel(contentBrief, date);

      const newSlot: ScheduleSlot = {
        key: matchedSuggestion
          ? `suggestion:${matchedSuggestion.id}:${date}:${time}`
          : `manual:${date}:${time}`,
        date,
        time,
        label,
        source: matchedSuggestion ? 'suggestion' : 'manual',
        suggestionId: matchedSuggestion?.id,
      };

      onSlotsChange([...selectedSlots, newSlot]);
    },
    [selectedSlots, suggestions, maxSlots, contentBrief, onSlotsChange, timezone],
  );

  const handleRemoveSlot = useCallback(
    (slotKey: string) => {
      onSlotsChange(selectedSlots.filter((s) => s.key !== slotKey));
    },
    [selectedSlots, onSlotsChange],
  );

  // -------------------------------------------------------------------------
  // Convert to ScheduleCalendar display format
  // -------------------------------------------------------------------------

  const calendarSelected: SelectedSlotDisplay[] = useMemo(
    () =>
      selectedSlots.map((slot) => ({
        key: slot.key,
        date: slot.date,
        time: slot.time,
      })),
    [selectedSlots],
  );

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  const showCalendar =
    contentBrief.contentType !== 'instant_post' || publishMode === 'schedule';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
                  onSlotsChange([]);
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

      {/* Post Now confirmation message */}
      {contentBrief.contentType === 'instant_post' && publishMode === 'now' && (
        <p className="text-sm text-muted-foreground">
          Your post will be queued for immediate publishing.
        </p>
      )}

      {/* Calendar */}
      {showCalendar && (
        <>
          {calendarWarning && (
            <div
              className="flex items-start gap-2 rounded-lg border p-3 text-sm"
              style={{ background: 'var(--c-orange-soft)', borderColor: 'var(--c-orange)', color: 'var(--c-ink)' }}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--c-orange)' }} />
              <span>{calendarWarning}</span>
            </div>
          )}
          {isLoadingItems && (
            <p className="text-xs text-muted-foreground text-center animate-pulse">
              Loading existing schedule...
            </p>
          )}
          <ScheduleCalendar
            timezone={timezone}
            initialMonth={initialMonth}
            selected={calendarSelected}
            suggestions={suggestions}
            existingItems={existingItems}
            onAddSlot={handleAddSlot}
            onRemoveSlot={handleRemoveSlot}
            onMonthChange={handleMonthChange}
            defaultSlotTime={contentBrief.contentType === 'story' ? STORY_POST_TIME : undefined}
          />
          <p className="text-xs text-muted-foreground text-center">
            {selectedSlots.length} slot{selectedSlots.length === 1 ? '' : 's'} selected.
          </p>
          {publishMode === 'schedule' && selectedSlots.length === 0 && (
            <p
              className="text-center text-sm font-medium"
              style={{ color: 'var(--c-orange)' }}
            >
              Select at least one date to continue
            </p>
          )}
        </>
      )}
    </div>
  );
}
