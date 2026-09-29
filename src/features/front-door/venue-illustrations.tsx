import { CalendarCheck2, CookingPot, Guitar, MapPin, Phone, Trophy, Utensils, type LucideIcon } from 'lucide-react';

import { CLICHE_EXAMPLES } from '@/content/homepage';
import { VENUE_TYPES } from '@/lib/signup/venue-form';

/**
 * The pictures in the homepage's "Made for hospitality" section, drawn with
 * HTML and the design tokens like the hero's planner card, so they stay sharp
 * and need no image. Each is an example, not a real venue, and shows what the
 * product does:
 *
 * - The event run-up: the posts two days before, the day before and on the
 *   day of a Friday 8pm event carry the labels proximity-label.ts gives them
 *   (THIS FRIDAY, TOMORROW NIGHT, TONIGHT), on a strip down the right of the
 *   picture where the publish worker prints it, on the feed and as a story.
 * - Weekly regulars: the create wizard's own slot names ("Thursday · Week 1").
 * - The venue voice: the sign-up form's venue types, the two tone sliders in
 *   the brand voice settings, and two of the clichés Cheers keeps out.
 * - The link-in-bio page: its Book a table, See our menu, Call us and Find us
 *   buttons and its Live now list.
 *
 * Screen readers get one description per picture instead of the parts.
 */

const CHIP = 'rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] font-medium leading-none';
const FRAME = 'w-full rounded-[var(--r-xl)] border border-line bg-card p-4 shadow-[var(--sh-sm)]';
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3';

const RUN_UP = [
  { day: 'Wed', label: 'THIS FRIDAY' },
  { day: 'Thu', label: 'TOMORROW NIGHT' },
  { day: 'Fri', label: 'TONIGHT' },
] as const;

export function EventRunUpIllustration(): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label="Posts for live music on Friday from 8pm, each on the feed and as a story. On Wednesday the strip on the picture says THIS FRIDAY, on Thursday TOMORROW NIGHT and on Friday TONIGHT."
      className="w-full max-w-[400px]"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Guitar aria-hidden="true" className="h-4 w-4 text-orange-hi" strokeWidth={2} />
        Live music, Friday from 8pm
      </p>
      <ol className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        {RUN_UP.map(({ day, label }) => (
          <li key={day} className="min-w-0">
            <p className={LABEL}>{day}</p>
            <div className="relative mt-1.5 aspect-[4/5] overflow-hidden rounded-[var(--r-lg)] bg-linear-to-br from-orange to-orange-hi shadow-[var(--sh-sm)]">
              <Guitar
                aria-hidden="true"
                className="absolute left-[40%] top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-white/90"
                strokeWidth={1.75}
              />
              <span className="absolute inset-y-0 right-0 flex w-5 items-center justify-center bg-ink">
                <span className="font-mono text-[8px] font-semibold tracking-[0.12em] text-white [writing-mode:vertical-rl]">
                  {label}
                </span>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className={`${CHIP} bg-[var(--c-status-scheduled-bg)] text-[var(--c-status-scheduled-fg)]`}>Feed</span>
              <span className={`${CHIP} bg-orange-soft text-orange-hi`}>Story</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const WEEKS = [1, 2, 3, 4] as const;

export function WeeklyRegularsIllustration(): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label="Curry night every Thursday at 6pm: a post written for each Thursday, every one scheduled, and more Thursdays up to the end date."
      className={`${FRAME} max-w-[400px]`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-orange-soft text-orange-hi">
          <CookingPot aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Curry night</p>
          <p className="text-xs text-ink-3">Every Thursday at 6pm</p>
        </div>
      </div>
      <ol className="mt-3 space-y-1.5">
        {WEEKS.map((week) => (
          <li
            key={week}
            className="flex items-center justify-between gap-2 rounded-[var(--r-lg)] border border-line bg-paper px-3 py-2"
          >
            <span className="text-[13px] font-medium text-ink-2">Thursday · Week {week}</span>
            <span className={`${CHIP} bg-[var(--c-status-scheduled-bg)] text-[var(--c-status-scheduled-fg)]`}>
              Scheduled
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-xs text-ink-3">And every Thursday after, up to your end date.</p>
    </div>
  );
}

const VENUE_CHOICES = VENUE_TYPES.filter((venue) => venue.value !== 'other').map((venue) => venue.label);

function ToneSlider({ from, to, dotClass }: { from: string; to: string; dotClass: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="relative h-1.5 rounded-[var(--r-pill)] bg-line">
        <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[var(--r-pill)] border-2 border-card bg-orange shadow-[var(--sh-sm)] ${dotClass}`} />
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-ink-3">
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}

export function VenueVoiceIllustration(): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label={`Brand voice settings: the venue type is Pub, the tone is set towards casual and playful, and phrases such as ${CLICHE_EXAMPLES.join(' and ')} are kept out.`}
      className={`${FRAME} max-w-[400px]`}
    >
      <p className={LABEL}>Venue type</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {VENUE_CHOICES.map((label, index) => (
          <span
            key={label}
            className={
              index === 0
                ? 'rounded-[var(--r-pill)] border border-orange bg-orange-soft px-2.5 py-1 text-xs font-semibold text-orange-hi'
                : 'rounded-[var(--r-pill)] border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-2'
            }
          >
            {label}
          </span>
        ))}
      </div>
      <p className={`${LABEL} mt-4`}>Tone</p>
      <div className="mt-2.5 grid grid-cols-2 gap-4">
        <ToneSlider from="Formal" to="Casual" dotClass="left-[75%]" />
        <ToneSlider from="Serious" to="Playful" dotClass="left-[60%]" />
      </div>
      <p className={`${LABEL} mt-4`}>Kept out</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CLICHE_EXAMPLES.map((phrase) => (
          <span
            key={phrase}
            className="rounded-[var(--r-pill)] bg-[var(--c-status-failed-bg)] px-2.5 py-1 text-xs font-medium text-[var(--c-status-failed-fg)] line-through"
          >
            {phrase}
          </span>
        ))}
      </div>
    </div>
  );
}

const LINK_BUTTONS: readonly { label: string; icon: LucideIcon }[] = [
  { label: 'Book a table', icon: CalendarCheck2 },
  { label: 'See our menu', icon: Utensils },
  { label: 'Call us', icon: Phone },
  { label: 'Find us', icon: MapPin },
];

export function LinkInBioIllustration(): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label="A link-in-bio page on a phone with Book a table, See our menu, Call us and Find us buttons, and a quiz night post under Live now."
      className="w-[220px] rounded-[28px] bg-ink p-1.5 shadow-[var(--sh-lg)]"
    >
      <div className="rounded-[22px] border border-white/10 px-3.5 pb-4 pt-3">
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-[var(--r-pill)] bg-white/20" />
        <div className="mt-3 flex flex-col items-center text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-[var(--r-pill)] bg-orange-soft font-mono text-xs font-semibold text-orange-hi">
            YV
          </span>
          <p className="mt-1.5 text-sm font-semibold text-white">Your venue</p>
        </div>
        <ul className="mt-3 space-y-1.5">
          {LINK_BUTTONS.map(({ label, icon: Icon }) => (
            <li
              key={label}
              className="flex items-center gap-2 rounded-[var(--r-lg)] bg-orange px-2.5 py-2 text-xs font-semibold text-ink"
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
              {label}
            </li>
          ))}
        </ul>
        <p className="mt-3.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--c-line-2)]">
          Live now
        </p>
        <div className="mt-1.5 flex items-center gap-2 rounded-[var(--r-lg)] bg-white/10 p-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-linear-to-br from-orange to-orange-hi">
            <Trophy aria-hidden="true" className="h-4 w-4 text-white" strokeWidth={2} />
          </span>
          <span className="text-xs font-medium text-white">Quiz night, Thursday</span>
        </div>
      </div>
    </div>
  );
}
