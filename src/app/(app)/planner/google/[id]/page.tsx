import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft } from "lucide-react";

import { GoogleTimeForm } from "@/features/planner/google-time-form";
import { GoogleVersionSection } from "@/features/planner/google-version-section";
import { MediaFrameImage } from "@/components/media/media-frame";
import { PlatformDot } from "@/components/ui/platform-dot";
import { Button } from "@/components/ui/button";
import { requireAuthContext } from "@/lib/auth/server";
import { readGooglePostDetail } from "@/lib/google-posts/post-detail";

/**
 * A Google post's own page (tasks/SPEC-gbp-separate-posts.md, decisions D14
 * and D16): its picture, its time and the Google section with its wording and
 * buttons. Opened from the Google tile in the planner.
 *
 * The Google post is read by its own id for the signed-in user's ACTIVE brand
 * only (service-role client scoped by account_id), and only when that brand's
 * Google switch is on; anything else is a 404, never another brand's post.
 * Its picture and default time come from the Facebook post it was made from.
 */

export const dynamic = "force-dynamic";

export default async function GooglePostPage({
  params,
}: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const ctx = await requireAuthContext();
  const detail = await readGooglePostDetail(ctx, id);
  if (!detail) notFound();

  const { version, section, title, currentTime, imageUrl, parentId, timezone, timezoneLabel } = detail;
  const when = currentTime ? DateTime.fromISO(currentTime, { zone: "utc" }).setZone(timezone) : null;
  const image = imageUrl ? { url: imageUrl } : null;
  const parent = parentId ? { id: parentId } : null;

  return (
    <div className="flex h-full flex-col gap-6 font-sans text-[var(--c-ink)]">
      <nav className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/planner" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to planner
          </Link>
        </Button>
        <span className="text-[var(--c-ink-4)]">/</span>
        <span className="text-[13px] text-[var(--c-ink-3)]">
          {when ? when.toFormat("d LLL yyyy · HH:mm") : "No time set"}
        </span>
      </nav>

      <section
        aria-labelledby="google-post-heading"
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 rounded-[var(--r-xl)] border border-[var(--c-line)] bg-[var(--c-card)] p-[18px] sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <PlatformDot platform="google" size={26} />
          <h1 id="google-post-heading" className="text-lg font-semibold">
            Google post: {title}
          </h1>
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div>
            {image ? (
              <MediaFrameImage
                src={image.url}
                alt="The picture this Google post is sent with"
                placement="feed"
                size="full"
                sizes="(max-width: 768px) 100vw, 320px"
              />
            ) : (
              <p className="rounded-[var(--r-md)] bg-[var(--c-paper-2)] p-4 text-sm text-[var(--c-ink-2)]">
                This Google post has no picture.
              </p>
            )}
            <p className="mt-2 text-sm text-[var(--c-ink-2)]">
              The picture comes from the Facebook post this was made from.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="eyebrow text-[var(--c-ink-3)]">When it goes out</h2>
              <GoogleTimeForm
                key={`${version.id}-${currentTime ?? "none"}`}
                contentId={version.contentItemId}
                currentTime={currentTime}
                hasOwnTime={version.ownTime !== null}
                canMove={version.canMove && section.kind === "ready"}
                timezone={timezone}
                timezoneLabel={timezoneLabel}
              />
            </div>

            {parent ? (
              <p className="text-sm text-[var(--c-ink-2)]">
                Made from a Facebook post.{" "}
                <Link
                  href={`/planner/${parent.id}`}
                  className="font-medium text-[var(--c-ink)] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-orange)]"
                >
                  Open the Facebook post
                </Link>
              </p>
            ) : (
              <p className="text-sm text-[var(--c-ink-2)]">
                The Facebook post this was made from has been removed, so this Google post will not be sent.
              </p>
            )}
          </div>
        </div>
      </section>

      <GoogleVersionSection section={section} timezone={timezone} />
    </div>
  );
}
