'use client';

import { useCallback, useState, useTransition } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Calendar, Check, Clock, Pencil, Trash2, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { updatePlannerContentBody, updatePlannerContentSchedule } from '@/app/(app)/planner/actions';
import { useToast } from '@/components/providers/toast-provider';
import type { Platform } from '@/types/content';
import type { PlannerContentDetail } from '@/lib/planner/data';

interface PostDrawerProps {
  contentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function fetchContentDetail(id: string): Promise<PlannerContentDetail | null> {
  const res = await fetch(`/api/content/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as PlannerContentDetail;
}

const EDITABLE_STATUSES = new Set(['draft', 'scheduled', 'queued', 'failed']);

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  queued: 'Queued',
  publishing: 'Publishing',
  posted: 'Published',
  published: 'Published',
  failed: 'Failed',
};

const STATUS_COLOURS: Record<string, { fg: string; bg: string }> = {
  draft: { fg: 'var(--status-draft-fg, #6b7280)', bg: 'var(--status-draft-bg, #f3f4f6)' },
  scheduled: { fg: 'var(--status-scheduled-fg, #2563eb)', bg: 'var(--status-scheduled-bg, #dbeafe)' },
  queued: { fg: 'var(--status-queued-fg, #7c3aed)', bg: 'var(--status-queued-bg, #ede9fe)' },
  publishing: { fg: 'var(--status-publishing-fg, #d97706)', bg: 'var(--status-publishing-bg, #fef3c7)' },
  posted: { fg: 'var(--status-published-fg, #059669)', bg: 'var(--status-published-bg, #d1fae5)' },
  published: { fg: 'var(--status-published-fg, #059669)', bg: 'var(--status-published-bg, #d1fae5)' },
  failed: { fg: 'var(--status-failed-fg, #dc2626)', bg: 'var(--status-failed-bg, #fee2e2)' },
};

export function PostDrawer({
  contentId,
  open,
  onOpenChange,
}: PostDrawerProps): React.JSX.Element {
  const {
    data: content,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['content-detail', contentId],
    queryFn: () => fetchContentDetail(contentId!),
    enabled: open && contentId != null,
    staleTime: 30_000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Post Details</SheetTitle>
          <SheetDescription>
            View and manage this scheduled content item.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {isLoading && <DrawerSkeleton />}

          {error && (
            <p className="text-sm text-destructive">
              Failed to load content details. Please try again.
            </p>
          )}

          {content && !isLoading && (
            <DrawerContent content={content} contentId={contentId!} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function DrawerContent({
  content,
  contentId,
}: {
  content: PlannerContentDetail;
  contentId: string;
}): React.JSX.Element {
  const canEdit = EDITABLE_STATUSES.has(content.status);
  const statusColours = STATUS_COLOURS[content.status] ?? STATUS_COLOURS.draft;

  return (
    <div className="space-y-5">
      {/* Status + Platform */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium"
          style={{ color: statusColours.fg, backgroundColor: statusColours.bg }}
        >
          <span
            className="inline-block size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusColours.fg }}
            aria-hidden="true"
          />
          {STATUS_LABELS[content.status] ?? content.status}
        </span>
        <PlatformBadge platform={content.platform as Platform} showLabel />
        {content.placement === 'story' && (
          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            Story
          </span>
        )}
      </div>

      {/* Campaign name */}
      {content.campaign?.name && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Campaign
          </h4>
          <p className="text-sm text-foreground">{content.campaign.name}</p>
        </div>
      )}

      {/* Schedule — inline editable */}
      <InlineScheduleEditor
        contentId={contentId}
        scheduledFor={content.scheduledFor}
        canEdit={canEdit}
      />

      {/* Media images — full width */}
      {content.media.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Media ({content.media.length})
          </h4>
          <div className="space-y-2">
            {content.media.map((m) => (
              <div
                key={m.id}
                className="relative w-full overflow-hidden rounded-lg bg-muted"
              >
                <Image
                  src={m.url}
                  alt={m.fileName ?? 'Post media'}
                  width={800}
                  height={800}
                  className="h-auto w-full"
                  sizes="(max-width: 448px) 100vw, 400px"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body copy — inline editable */}
      <InlineCopyEditor
        contentId={contentId}
        initialBody={content.body}
        canEdit={canEdit && content.placement !== 'story'}
        isStory={content.placement === 'story'}
      />

      {/* Error info for failed posts */}
      {content.status === 'failed' && content.lastError && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-destructive">
            <AlertTriangle className="mb-0.5 mr-1 inline size-3.5" aria-hidden />
            Error
          </h4>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{content.lastError}</p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Schedule Editor                                            */
/* ------------------------------------------------------------------ */

function InlineScheduleEditor({
  contentId,
  scheduledFor,
  canEdit,
}: {
  contentId: string;
  scheduledFor: string | null;
  canEdit: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const scheduledDt = scheduledFor
    ? DateTime.fromISO(scheduledFor, { zone: DEFAULT_TIMEZONE })
    : null;

  const [date, setDate] = useState(scheduledDt?.toISODate() ?? '');
  const [time, setTime] = useState(scheduledDt?.toFormat('HH:mm') ?? '');

  const minDate = DateTime.now().setZone(DEFAULT_TIMEZONE).toISODate() ?? '';

  const handleSave = useCallback(() => {
    if (!date || !time) return;
    startTransition(async () => {
      try {
        const result = await updatePlannerContentSchedule({ contentId, date, time });
        if ('error' in result && typeof result.error === 'string') {
          toast.error('Could not update', { description: result.error });
          return;
        }
        toast.success('Schedule updated');
        setEditing(false);
        queryClient.invalidateQueries({ queryKey: ['content-detail', contentId] });
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to update schedule.';
        toast.error('Could not update', { description: msg });
      }
    });
  }, [contentId, date, time, toast, queryClient, router]);

  const handleCancel = useCallback(() => {
    setDate(scheduledDt?.toISODate() ?? '');
    setTime(scheduledDt?.toFormat('HH:mm') ?? '');
    setEditing(false);
  }, [scheduledDt]);

  if (!scheduledDt?.isValid && !editing) return <></>;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scheduled
        </h4>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-primary hover:underline"
          >
            <Pencil className="mr-0.5 inline size-3" aria-hidden />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <input
              type="time"
              value={time}
              step={60}
              onChange={(e) => setTime(e.target.value)}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !date || !time}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Check className="size-3" aria-hidden />
              {isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-3.5 text-muted-foreground" aria-hidden />
            {scheduledDt!.toFormat('cccc d LLLL yyyy')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 text-muted-foreground" aria-hidden />
            {scheduledDt!.toFormat('HH:mm')}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Copy Editor                                                */
/* ------------------------------------------------------------------ */

function InlineCopyEditor({
  contentId,
  initialBody,
  canEdit,
  isStory,
}: {
  contentId: string;
  initialBody: string;
  canEdit: boolean;
  isStory: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [isPending, startTransition] = useTransition();

  const handleSave = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await updatePlannerContentBody({ contentId, body: trimmed });
        toast.success('Copy updated');
        setEditing(false);
        queryClient.invalidateQueries({ queryKey: ['content-detail', contentId] });
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to save.';
        toast.error('Save failed', { description: msg });
      }
    });
  }, [contentId, body, toast, queryClient, router]);

  const handleCancel = useCallback(() => {
    setBody(initialBody);
    setEditing(false);
  }, [initialBody]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Copy
        </h4>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-primary hover:underline"
          >
            <Pencil className="mr-0.5 inline size-3" aria-hidden />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            disabled={isPending}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {body.length.toLocaleString()} characters
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || !body.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Check className="size-3" aria-hidden />
                {isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {initialBody ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {initialBody}
              </p>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {isStory ? 'Stories publish without captions.' : 'No copy yet.'}
              {canEdit && !isStory && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="ml-1 text-primary hover:underline"
                >
                  Add copy
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
