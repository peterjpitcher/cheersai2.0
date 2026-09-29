import { ChefHat, CircleCheck, Sparkles, Trophy, UtensilsCrossed, type LucideIcon } from 'lucide-react';

/**
 * The hero's picture of a week in the planner, drawn with HTML and the design
 * tokens rather than a screenshot, so it stays sharp and needs no image. The
 * posts are examples, not a real venue. The labels match the product: the
 * event-day post goes out at 07:00 with a feed post and a story, carries a
 * "TONIGHT" banner on its photo, and the badges read Scheduled and Posted as
 * they do in the planner. Screen readers get one description instead of the
 * parts.
 */

interface ExamplePost {
  day: string;
  title: string;
  time: string;
  status: 'Scheduled' | 'Posted';
  platforms: readonly ('Facebook' | 'Instagram')[];
  story: boolean;
  banner: string | null;
  icon: LucideIcon;
  /** Thumbnail background: static class names so Tailwind keeps them. */
  thumbClass: string;
}

const POSTS: readonly ExamplePost[] = [
  {
    day: 'Thu',
    title: 'Quiz night from 8pm',
    time: '07:00',
    status: 'Scheduled',
    platforms: ['Facebook', 'Instagram'],
    story: true,
    banner: 'TONIGHT',
    icon: Trophy,
    thumbClass: 'bg-linear-to-br from-orange to-orange-hi',
  },
  {
    day: 'Fri',
    title: 'Fish and chips Friday',
    time: '12:00',
    status: 'Scheduled',
    platforms: ['Facebook', 'Instagram'],
    story: false,
    banner: null,
    icon: UtensilsCrossed,
    thumbClass: 'bg-linear-to-br from-orange-hi to-[var(--c-orange-lo)]',
  },
  {
    day: 'Sun',
    title: 'Sunday roasts are back',
    time: '12:00',
    status: 'Posted',
    platforms: ['Facebook'],
    story: false,
    banner: null,
    icon: ChefHat,
    thumbClass: 'bg-linear-to-br from-ink-2 to-ink',
  },
];

const CHIP = 'rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] font-medium leading-none';

const DESCRIPTION =
  'An example week in the Cheers planner: a quiz night post with a Tonight banner and a story, scheduled for 7am, a Friday food post scheduled for noon, and a Sunday roast post already posted.';

function PlatformChip({ platform }: { platform: 'Facebook' | 'Instagram' }): React.JSX.Element {
  return platform === 'Facebook' ? (
    <span className={`${CHIP} bg-fb-bg text-fb`}>Facebook</span>
  ) : (
    <span className={`${CHIP} bg-ig-bg text-ig`}>Instagram</span>
  );
}

function StatusBadge({ status }: { status: ExamplePost['status'] }): React.JSX.Element {
  return status === 'Posted' ? (
    <span className={`${CHIP} bg-[var(--c-status-posted-bg)] text-[var(--c-status-posted-fg)]`}>Posted</span>
  ) : (
    <span className={`${CHIP} bg-[var(--c-status-scheduled-bg)] text-[var(--c-status-scheduled-fg)]`}>Scheduled</span>
  );
}

export function PlannerIllustration(): React.JSX.Element {
  return (
    <div className="relative mx-auto w-full max-w-[460px] lg:mx-0 lg:justify-self-end">
      <div
        role="img"
        aria-label={DESCRIPTION}
        className="relative rounded-[var(--r-2xl)] bg-card p-4 shadow-[var(--sh-lg)] ring-1 ring-white/10 sm:p-5 lg:rotate-[1.25deg]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">This week</p>
            <p className="text-xs text-ink-3">3 posts, all approved</p>
          </div>
          <div className="flex gap-1.5">
            <PlatformChip platform="Facebook" />
            <PlatformChip platform="Instagram" />
          </div>
        </div>

        <ol className="mt-4 space-y-2.5">
          {POSTS.map((post) => {
            const Icon = post.icon;
            return (
              <li key={post.day} className="flex gap-3">
                <span className="w-8 shrink-0 pt-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
                  {post.day}
                </span>
                <div className="flex min-w-0 flex-1 gap-3 rounded-[var(--r-xl)] border border-line bg-paper p-2.5">
                  <div
                    className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--r-lg)] ${post.thumbClass}`}
                  >
                    <Icon className="h-7 w-7 text-white/90" strokeWidth={1.75} />
                    {post.banner ? (
                      <span className="absolute inset-x-0 bottom-0 bg-ink py-0.5 text-center font-mono text-[8px] font-semibold tracking-[0.12em] text-white">
                        {post.banner}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-sm font-semibold text-ink">{post.title}</p>
                    <div className="flex flex-wrap gap-1">
                      {post.platforms.map((platform) => (
                        <PlatformChip key={platform} platform={platform} />
                      ))}
                      {post.story ? <span className={`${CHIP} bg-orange-soft text-orange-hi`}>Story</span> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={post.status} />
                      <span className="font-mono text-[11px] text-ink-3">{post.time}</span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 flex items-center gap-2 rounded-[var(--r-lg)] bg-orange-tint px-3 py-2 text-xs font-medium text-ink-2">
          <CircleCheck className="h-4 w-4 shrink-0 text-[var(--c-status-posted-fg)]" strokeWidth={2} />
          Approved by you. Cheers posts each one on time.
        </p>
      </div>

      <p
        aria-hidden="true"
        className="absolute -top-4 right-5 hidden rotate-2 items-center gap-1.5 rounded-[var(--r-pill)] bg-card px-3 py-1.5 text-xs font-semibold text-ink shadow-[var(--sh-md)] ring-1 ring-line lg:flex"
      >
        <Sparkles className="h-3.5 w-3.5 text-orange-hi" strokeWidth={2} />
        Written in your voice
      </p>
    </div>
  );
}
