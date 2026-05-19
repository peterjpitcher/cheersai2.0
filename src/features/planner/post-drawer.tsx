'use client';

import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Calendar, Clock, Pencil, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { StatusChip } from '@/components/ui/status-chip';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { ContentItem, Platform, PlatformCopy } from '@/types/content';

interface PostDrawerProps {
  contentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fetch content item details for the drawer.
 * Uses the API route to respect RLS in a client component context.
 */
async function fetchContentItem(id: string): Promise<ContentItem | null> {
  const res = await fetch(`/api/content/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data as ContentItem;
}

/**
 * Side drawer for viewing post details (UX-10).
 * Opens from the right side on desktop via Radix Sheet.
 * Shows content details, status, platform info, and action buttons.
 * Focus trap and Escape-to-close provided by Radix Sheet (UX-08).
 */
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
    queryKey: ['content-item', contentId],
    queryFn: () => fetchContentItem(contentId!),
    enabled: open && contentId != null,
    staleTime: 30_000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{content?.title ?? 'Post Details'}</SheetTitle>
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

          {content && !isLoading && <DrawerContent content={content} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-20 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function DrawerContent({ content }: { content: ContentItem }): React.JSX.Element {
  const scheduledDt = content.scheduledAt
    ? DateTime.fromJSDate(
        typeof content.scheduledAt === 'string'
          ? new Date(content.scheduledAt as unknown as string)
          : content.scheduledAt,
        { zone: DEFAULT_TIMEZONE },
      )
    : null;

  const draft = content.bodyDraft as Record<string, unknown> | null;
  const platforms: Platform[] = Array.isArray(draft?.platforms)
    ? (draft.platforms as Platform[])
    : [];
  const generatedCopy = draft?.generatedCopy as PlatformCopy | undefined;
  const selectedMediaIds = (draft?.selectedMediaIds as string[]) ?? [];

  const contentTypeLabels: Record<string, string> = {
    instant_post: 'Instant Post',
    story: 'Story',
    event: 'Event',
    promotion: 'Promotion',
    weekly_recurring: 'Weekly Recurring',
  };

  return (
    <div className="space-y-5">
      {/* Status and content type */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={content.status} size="md" />
        <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          {contentTypeLabels[content.contentType] ?? content.contentType}
        </span>
      </div>

      {/* Platform badges */}
      {platforms.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Platforms
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((p) => (
              <PlatformBadge key={p} platform={p} showLabel />
            ))}
          </div>
        </div>
      )}

      {/* Schedule info */}
      {scheduledDt?.isValid && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scheduled
          </h4>
          <div className="flex items-center gap-3 text-sm text-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5 text-muted-foreground" aria-hidden />
              {scheduledDt.toFormat('cccc d LLLL yyyy')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted-foreground" aria-hidden />
              {scheduledDt.toFormat('HH:mm')} (Europe/London)
            </span>
          </div>
        </div>
      )}

      {/* AI-generated copy preview */}
      {generatedCopy && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Generated Copy
          </h4>
          {generatedCopy.facebook && (
            <CopyPreview platform="Facebook" body={generatedCopy.facebook.body} />
          )}
          {generatedCopy.instagram && (
            <CopyPreview platform="Instagram" body={generatedCopy.instagram.body} />
          )}
          {generatedCopy.gbp && (
            <CopyPreview platform="Google" body={generatedCopy.gbp.body} />
          )}
        </div>
      )}

      {/* Media thumbnails */}
      {selectedMediaIds.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Media ({selectedMediaIds.length})
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {selectedMediaIds.slice(0, 6).map((mediaId) => (
              <div
                key={mediaId}
                className="aspect-square rounded-md bg-muted"
                title={`Media: ${mediaId}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Pencil className="size-3.5" aria-hidden />
          Edit
        </button>
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

function CopyPreview({
  platform,
  body,
}: {
  platform: string;
  body: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {platform}
      </p>
      <p className="text-sm leading-relaxed text-foreground line-clamp-4">{body}</p>
    </div>
  );
}
