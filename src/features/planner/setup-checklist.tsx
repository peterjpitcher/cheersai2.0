import Link from 'next/link';
import { Check } from 'lucide-react';

import type { SetupProgress } from '@/lib/onboarding/setup-progress';

interface SetupChecklistProps {
  progress: SetupProgress;
  isOwner: boolean;
}

interface Step {
  key: keyof Omit<SetupProgress, 'show'>;
  title: string;
  detail: string;
  href: string;
  ownerOnly?: boolean;
}

const STEPS: Step[] = [
  {
    key: 'profile',
    title: 'Tell us about your venue',
    detail: 'Add your business type and a short description so the AI writes in your voice.',
    href: '/settings',
  },
  {
    key: 'facebook',
    title: 'Connect Facebook',
    detail: 'Link the Facebook Page you want to post to.',
    href: '/connections',
    ownerOnly: true,
  },
  {
    key: 'instagram',
    title: 'Connect Instagram',
    detail: 'Link your Instagram business account. You can post with just one of the two.',
    href: '/connections',
    ownerOnly: true,
  },
  {
    key: 'firstPost',
    title: 'Publish your first post',
    detail: 'Create a post and schedule it. This ticks off once Facebook or Instagram confirms it went out.',
    href: '/create',
  },
];

/**
 * First-run checklist on the planner (piece 2.8). Shown until the brand's
 * first post is published; progress comes from the brand's own data.
 */
export function SetupChecklist({ progress, isOwner }: SetupChecklistProps) {
  if (!progress.show) return null;
  const done = STEPS.filter((step) => progress[step.key]).length;

  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="rounded-xl p-4 md:p-5"
      style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-line)', boxShadow: 'var(--sh-sm)' }}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-checklist-title" className="text-base font-semibold" style={{ color: 'var(--c-ink)' }}>
          Get set up
        </h2>
        <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          {done} of {STEPS.length} done
        </p>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((step) => {
          const complete = progress[step.key];
          const blocked = step.ownerOnly && !isOwner && !complete;
          return (
            <li
              key={step.key}
              className="flex gap-3 rounded-lg p-3"
              style={{ border: '1px solid var(--c-line)', opacity: complete ? 0.7 : 1 }}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: complete ? 'var(--c-status-posted-fg)' : 'var(--c-line)' }}
              >
                {complete ? <Check size={12} /> : null}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
                  {complete || blocked ? (
                    step.title
                  ) : (
                    <Link href={step.href} className="underline-offset-4 hover:underline">
                      {step.title}
                    </Link>
                  )}
                  <span className="sr-only">{complete ? ' (done)' : ' (to do)'}</span>
                </p>
                <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                  {blocked ? 'Ask an owner of this brand to do this.' : step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
