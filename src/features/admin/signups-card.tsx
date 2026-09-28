import type { ReactNode } from 'react';

import type { SignupsOverview } from '@/lib/signup/admin-overview';
import {
  DIGEST_LIST_LIMIT,
  NEVER_STARTED_DAYS,
  STUCK_NO_CHECKOUT_DAYS,
  STUCK_NO_CONNECTION_DAYS,
  STUCK_VERIFIED_DAYS,
} from '@/lib/signup/digest';
import type { SignupFunnelCounts } from '@/lib/signup/funnel';
import { formatUkDateTime, formatUkLongDate } from '@/lib/utils/date';

// ---------------------------------------------------------------------------
// Admin Sign-ups card (tasks/SPEC-self-serve-signup.md §4.9, §4.10, P10).
// Server component: the admin page gates on the super-admin flag before it
// loads the data, so nothing here reaches anyone else. It shows the funnel
// and the daily operator email's lists; no email address or other personal
// detail, only venue names and, for a login with no venue yet, its id.
// Rendering never throws, so a bad value cannot take the admin page down.
// ---------------------------------------------------------------------------

const CARD = 'rounded-lg border p-4';
const CARD_STYLE = { borderColor: 'var(--c-line)' } as const;

const FUNNEL_STEPS: Array<{ key: keyof SignupFunnelCounts; label: string }> = [
  { key: 'requested', label: 'Asked to sign up' },
  { key: 'verified', label: 'Confirmed their email' },
  { key: 'venueCreated', label: 'Set up a venue' },
  { key: 'checkoutConfirmed', label: 'Started a plan (Checkout)' },
  { key: 'channelConnected', label: 'Connected Facebook or Instagram' },
  { key: 'firstPost', label: 'Published a first post' },
];

function longDate(value: string): string {
  return formatUkLongDate(value) || 'unknown date';
}

function dateTime(value: string): string {
  return formatUkDateTime(value) || 'unknown time';
}

function daysAgo(days: number): string {
  if (!Number.isFinite(days)) return 'age unknown';
  if (days === 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function List<T>({ items, render, empty = 'None.' }: { items: T[]; render: (item: T) => ReactNode; empty?: string }) {
  if (items.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
        {empty}
      </p>
    );
  }
  const shown = items.slice(0, DIGEST_LIST_LIMIT);
  const more = items.length - shown.length;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--c-ink-2)' }}>
      {shown.map((item, index) => (
        <li key={index} className="break-words">
          {render(item)}
        </li>
      ))}
      {more > 0 ? <li>and {more} more</li> : null}
    </ul>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>
      {children}
    </p>
  );
}

function SwitchLine({ signupSwitch }: { signupSwitch: 'open' | 'closed' | 'unavailable' }) {
  const text =
    signupSwitch === 'open'
      ? 'Sign-up is open.'
      : signupSwitch === 'closed'
        ? 'Sign-up is closed (the self_serve_signup switch is off), so these figures stay at zero until it opens.'
        : 'The sign-up switch could not be read just now, so customers are treated as if sign-up is closed.';
  return (
    <p className="mb-3 text-xs" style={{ color: 'var(--c-ink-2)' }}>
      {text}
    </p>
  );
}

export function SignupsCard({ overview }: { overview: SignupsOverview }): React.JSX.Element {
  return (
    // id: so a link or email can point straight at this card (/admin#signups).
    <div id="signups" className={CARD} style={CARD_STYLE}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
        Sign-ups
      </h2>
      <p className="mb-2 text-xs" style={{ color: 'var(--c-ink-3)' }}>
        Venues that signed up on their own, read when this page loaded ({dateTime(overview.readAt)}, UK time). The same
        lists as the daily operator email. Brands you created are never counted.
      </p>

      {overview.status === 'error' ? (
        <div
          role="alert"
          className="rounded-md p-3 text-sm"
          style={{ background: 'var(--c-claret-soft)', color: 'var(--c-claret)' }}
        >
          <p className="font-medium">The sign-up figures could not be read.</p>
          <p className="mt-1 break-words">{overview.message}</p>
          <p className="mt-1">The rest of this page is unaffected. Reload to try again; the logs have the detail.</p>
        </div>
      ) : (
        <>
          <SwitchLine signupSwitch={overview.signupSwitch} />

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="mb-1 text-left text-xs" style={{ color: 'var(--c-ink-3)' }}>
                Funnel, counted by when each login asked to sign up, over London calendar days (today included).
              </caption>
              <thead>
                <tr className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Step
                  </th>
                  {overview.funnel.windows.map((window) => (
                    <th key={window.days} scope="col" className="py-1 pr-3 text-right font-medium">
                      Last {window.days} days
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FUNNEL_STEPS.map((step) => (
                  <tr key={step.key} className="border-t" style={{ borderTopColor: 'var(--c-line)' }}>
                    <th scope="row" className="py-2 pr-3 text-sm font-normal" style={{ color: 'var(--c-ink)' }}>
                      {step.label}
                    </th>
                    {overview.funnel.windows.map((window) => (
                      <td
                        key={window.days}
                        className="py-2 pr-3 text-right text-sm tabular-nums"
                        style={{ color: 'var(--c-ink)' }}
                      >
                        {window.counts[step.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Section title="Sign-up problems in the last 24 hours">
            <Note>Failures recorded as operator_signup_alert, by kind. Each visitor was refused with an error. The logs have the detail.</Note>
            <List
              items={overview.digest.alerts}
              render={(alert) => (
                <>
                  <strong>{alert.kind}</strong>: {alert.rows === 1 ? '1 time' : `${alert.rows} times`}, last at{' '}
                  {dateTime(alert.lastAt)} (UK time)
                </>
              )}
            />
          </Section>

          <Section title="Stuck sign-ups">
            <Note>
              Confirmed their email at least {STUCK_VERIFIED_DAYS} day ago but have not set up a venue (login id; no venue
              yet, so no name):
            </Note>
            <List
              items={overview.digest.verifiedWithoutVenue}
              render={(item) => (
                <>
                  <code className="text-xs">{item.userId}</code>: confirmed {longDate(item.verifiedAt)}, {daysAgo(item.days)}
                </>
              )}
            />
            <div className="mt-3">
              <Note>Set up a venue at least {STUCK_NO_CHECKOUT_DAYS} days ago but have not started a plan through Checkout:</Note>
              <List
                items={overview.digest.noCheckout}
                render={(item) => (
                  <>
                    <strong>{item.name}</strong>: venue set up {longDate(item.since)}, {daysAgo(item.days)}
                  </>
                )}
              />
            </div>
            <div className="mt-3">
              <Note>On a free trial for at least {STUCK_NO_CONNECTION_DAYS} days with no Facebook or Instagram connected:</Note>
              <List
                items={overview.digest.trialWithoutConnection}
                render={(item) => (
                  <>
                    <strong>{item.name}</strong>: trial started {longDate(item.since)}, {daysAgo(item.days)}
                  </>
                )}
              />
            </div>
          </Section>

          <Section title={`Never started a plan (${NEVER_STARTED_DAYS} days)`}>
            <Note>
              Signed up on their own at least {NEVER_STARTED_DAYS} days ago and never started a subscription (decision P7).
              You decide whether to close one: use Offboard in the{' '}
              <a href="#offboarding" className="underline underline-offset-2">
                Offboarding
              </a>{' '}
              card. To keep one, set its billing override.
            </Note>
            <List
              items={overview.digest.neverStarted}
              render={(item) => (
                <>
                  <strong>{item.name}</strong>: venue set up {longDate(item.since)}, {daysAgo(item.days)}
                </>
              )}
            />
          </Section>
        </>
      )}
    </div>
  );
}

/** Streams the card in once its reads finish, so a slow read never holds up the rest of the admin page. */
export async function SignupsCardSection({ overview }: { overview: Promise<SignupsOverview> }): Promise<React.JSX.Element> {
  return <SignupsCard overview={await overview} />;
}

export function SignupsCardSkeleton(): React.JSX.Element {
  return (
    <div className={CARD} style={CARD_STYLE} aria-busy="true">
      <h2 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>
        Sign-ups
      </h2>
      <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
        Loading the sign-up figures…
      </p>
    </div>
  );
}
