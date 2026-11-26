'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';

import { loadGooglePostDetail } from '@/app/(app)/planner/google-version-actions';
import { PlatformDot } from '@/components/ui/platform-dot';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { GoogleTimeForm } from '@/features/planner/google-time-form';
import { GoogleVersionSection } from '@/features/planner/google-version-section';
import type { GooglePostDetail } from '@/lib/google-posts/post-detail';

/**
 * The planner drawer for a Google post, so clicking a Google tile behaves as
 * clicking a Facebook or Instagram one does (Peter, 26 November 2026). It
 * shows what the Google post's own page shows, from the same reader
 * (src/lib/google-posts/post-detail.ts): the picture, when it goes out, the
 * wording and the buttons. The full page stays, one link away.
 */

interface GooglePostDrawerProps {
  googlePostId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LINK_CLASS =
  'font-medium text-[var(--c-ink)] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-orange)]';

async function fetchDetail(id: string): Promise<GooglePostDetail | null> {
  const result = await loadGooglePostDetail({ id });
  if (result.error) throw new Error(result.error);
  return result.detail;
}

export function GooglePostDrawer({ googlePostId, open, onOpenChange }: GooglePostDrawerProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const queryKey = ['google-post-detail', googlePostId];
  const { data: detail, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchDetail(googlePostId!),
    enabled: open && googlePostId != null,
    staleTime: 30_000,
  });
  // The section and the time form change the post through server actions; read it again afterwards.
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Google post</SheetTitle>
          <SheetDescription>View and manage this Google post.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {isLoading && (
            <div className="space-y-4">
              <Skeleton className="h-6 w-40 rounded-full" />
              <Skeleton className="h-48 w-full rounded-lg" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {error && <p className="text-sm text-destructive">We could not load this Google post. Please try again.</p>}

          {!isLoading && !error && detail === null && (
            <p className="text-sm text-[var(--c-ink-2)]">This Google post could not be found.</p>
          )}

          {detail && !isLoading && <DrawerBody detail={detail} onChanged={refresh} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ detail, onChanged }: { detail: GooglePostDetail; onChanged: () => void }): React.JSX.Element {
  const { version, section, title, currentTime, imageUrl, parentId, timezone, timezoneLabel } = detail;
  const when = currentTime ? DateTime.fromISO(currentTime, { zone: 'utc' }).setZone(timezone) : null;

  return (
    <div className="flex flex-col gap-5 text-[var(--c-ink)]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <PlatformDot platform="google" size={22} />
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-[var(--c-ink-2)]">{when ? when.toFormat('cccc d LLLL yyyy, HH:mm') : 'No time set'}</p>
      </div>

      {imageUrl ? (
        // A short-lived signed link from our own storage: a plain image, as the post drawer's media frame uses.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="The picture this Google post is sent with"
          className="w-full rounded-[var(--r-lg)] border border-[var(--c-line)]"
        />
      ) : (
        <p className="rounded-[var(--r-md)] bg-[var(--c-paper-2)] p-4 text-sm text-[var(--c-ink-2)]">This Google post has no picture.</p>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="eyebrow text-[var(--c-ink-3)]">When it goes out</h4>
        <GoogleTimeForm
          key={`${version.id}-${currentTime ?? 'none'}`}
          contentId={version.contentItemId}
          currentTime={currentTime}
          hasOwnTime={version.ownTime !== null}
          canMove={version.canMove && section.kind === 'ready'}
          timezone={timezone}
          timezoneLabel={timezoneLabel}
          onChanged={onChanged}
        />
      </div>

      <div className="border-t border-[var(--c-line)] pt-5">
        <GoogleVersionSection section={section} timezone={timezone} onChanged={onChanged} compact />
      </div>

      <p className="border-t border-[var(--c-line)] pt-4 text-sm text-[var(--c-ink-2)]">
        {parentId ? (
          <>
            Made from a Facebook post.{' '}
            <Link href={`/planner/${parentId}`} className={LINK_CLASS}>
              Open the Facebook post
            </Link>
            {' · '}
          </>
        ) : (
          'The Facebook post this was made from has been removed, so this Google post will not be sent. '
        )}
        <Link href={`/planner/google/${version.id}`} className={LINK_CLASS}>
          Open full page
        </Link>
      </p>
    </div>
  );
}
