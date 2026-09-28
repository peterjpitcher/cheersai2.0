import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { getFirstPostHelpHref } from '@/lib/help/first-post';
import { CONTACT } from '@/lib/legal/company';

// ---------------------------------------------------------------------------
// "How to publish your first post" (tasks/SPEC-self-serve-signup.md, P10).
// The steps and labels follow the create wizard as built (src/features/
// create/steps): Brief, Media, Schedule, Generate. Linked from the planner's
// "Get set up" checklist and the Help Centre. Hidden (not found) while the
// self-serve sign-up switch is off or cannot be read.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'How to publish your first post | Cheers',
  description: 'Create, approve and publish your first Facebook or Instagram post with Cheers.',
  alternates: { canonical: '/help/first-post' },
};

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ backgroundColor: 'var(--c-orange-soft)', color: 'var(--c-ink)' }}
      >
        {number}
      </span>
      <div className="min-w-0 space-y-2">
        <h3 className="text-base font-semibold" style={{ color: 'var(--c-ink)' }}>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <strong style={{ color: 'var(--c-ink)' }}>{children}</strong>;
}

export default async function FirstPostHelpPage(): Promise<React.JSX.Element> {
  if (!(await getFirstPostHelpHref())) notFound();

  return (
    <main className="mx-auto max-w-[720px] px-4 py-12 sm:py-16" style={{ color: 'var(--c-ink)' }}>
      <p className="text-sm">
        <Link href="/help" className="hover:underline" style={{ color: 'var(--c-ink-3)' }}>
          Help Centre
        </Link>
      </p>

      <header className="mt-4 space-y-3">
        <h1 className="text-2xl font-semibold sm:text-3xl" style={{ color: 'var(--c-ink)' }}>
          How to publish your first post
        </h1>
        <p className="text-base leading-relaxed" style={{ color: 'var(--c-ink-2)' }}>
          Cheers writes the words for you. You check them, approve them and choose when the post goes out.
        </p>
      </header>

      <div className="mt-8 space-y-8 text-sm leading-relaxed" style={{ color: 'var(--c-ink-2)' }}>
        <section className="space-y-2">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>
            Before you start
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Connect Facebook, Instagram or both on the{' '}
              <Link href="/connections" className="font-semibold hover:underline" style={{ color: 'var(--c-orange)' }}>
                Connections
              </Link>{' '}
              page. One of the two is enough. Only an owner of the venue can connect them.
            </li>
            <li>
              Have a photo ready if you are posting to Instagram. Instagram needs a photo with every post, and videos
              cannot go to Instagram yet.
            </li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>
            Step by step
          </h2>
          <ol className="space-y-6">
            <Step number={1} title="Open Create">
              <p>
                Select <Label>Create</Label> in the menu. The steps are shown at the top: Brief, Media, Schedule and
                Generate.
              </p>
            </Step>
            <Step number={2} title="Brief: say what the post is about">
              <p>
                <Label>Instant Post</Label> is already chosen, which is right for a one-off post. Give it a short{' '}
                <Label>Title</Label>, then write a line or two under{' '}
                <Label>Brief / prompt</Label>, for example: &ldquo;Quiz night this Thursday from 8pm, free entry, prizes
                for the top three teams.&rdquo;
              </p>
              <p>
                Under <Label>Platforms</Label>, leave Facebook and Instagram on, or turn one off. Then select{' '}
                <Label>Next</Label>.
              </p>
            </Step>
            <Step number={3} title="Media: add a photo">
              <p>
                Use <Label>Attach Media</Label> to upload a photo or pick one from your library. It is optional for
                Facebook and needed for Instagram. Then select <Label>Next</Label>.
              </p>
            </Step>
            <Step number={4} title="Schedule: choose when it goes out">
              <p>
                Under <Label>When to publish</Label>, choose <Label>Post Now</Label> to send it straight away, or{' '}
                <Label>Schedule</Label> to pick a day and time. Times are UK time. Then select <Label>Next</Label>.
              </p>
            </Step>
            <Step number={5} title="Generate: check the words and approve">
              <p>
                Select <Label>Generate Content</Label>. Cheers writes a version for each platform. Read each{' '}
                <Label>Final publish preview</Label> and change any words you like, or use the buttons such as{' '}
                <Label>Make shorter</Label> or <Label>Stronger CTA</Label> to have it rewritten.
              </p>
              <p>
                When you are happy, select <Label>Approve this post</Label> on each version you want to publish, then{' '}
                <Label>Post approved</Label> (or <Label>Schedule approved</Label> if you chose a time).{' '}
                <Label>Save as Draft</Label> keeps it for later instead.
              </p>
            </Step>
          </ol>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>
            After you approve it
          </h2>
          <p>
            Cheers takes you back to the planner. The post shows as <Label>Scheduled</Label> or{' '}
            <Label>Publishing</Label>, then <Label>Posted</Label> once Facebook or Instagram confirms it went out. The
            &ldquo;Publish your first post&rdquo; step in <Label>Get set up</Label> then ticks off.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--c-ink)' }}>
            If it does not go out
          </h2>
          <p>
            A banner above the planner says a post needs attention. Select <Label>View failed posts</Label> to see why.
            For example, an Instagram post without a photo, or a Facebook or Instagram connection that needs
            reconnecting on the Connections page.
          </p>
          <p>
            Still stuck? Email{' '}
            <a
              href={`mailto:${CONTACT.email}`}
              className="font-semibold hover:underline"
              style={{ color: 'var(--c-orange)' }}
            >
              {CONTACT.email}
            </a>{' '}
            and we will help.
          </p>
        </section>
      </div>
    </main>
  );
}
