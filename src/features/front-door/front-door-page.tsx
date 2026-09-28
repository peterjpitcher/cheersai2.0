import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ContactEmail, ContactWhatsApp, LegalFooter, LegalLink } from "@/features/legal/legal-page";
import { priceCards, trialLines } from "@/features/front-door/pricing";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { CONTACT, LEGAL_DOCUMENTS } from "@/lib/legal/company";
import type { FrontDoorCta } from "@/lib/signup/front-door";

/**
 * The signed-out landing and pricing page at `/` (SPEC-self-serve-signup §4.1).
 *
 * Copy comes only from the terms, `plans.ts` and `company.ts`, plus wording
 * already public on the login page. It never mentions paid ads or tournaments:
 * new venues do not get them (decision D1b). No cookies, no client script.
 *
 * `cta` follows the sign-up switch: "trial" offers "Start your free trial";
 * anything else offers "Talk to us" with the email and WhatsApp contacts.
 */

interface FrontDoorPageProps {
  cta: FrontDoorCta;
}

const SIGNUP_PATH = "/signup";
const LOGIN_PATH = "/login";

const inkStyle = { color: "var(--c-ink)" } as const;
const mutedStyle = { color: "var(--c-ink-3)" } as const;
const linkStyle = { color: "var(--c-orange)" } as const;

const FEATURES = [
  "Plan, write and schedule posts in one place.",
  "Start from AI-written suggestions.",
  "Store your photos and videos.",
  "Publish to the Facebook Page and Instagram account you connect.",
  "Run a link-in-bio page.",
] as const;

const STEPS = [
  {
    title: "Write once",
    body: "Start from an AI suggestion or your own words. Cheers adapts the post for Facebook and Instagram.",
  },
  {
    title: "Check it",
    body: "AI suggestions are drafts. You check every post, including prices, dates and offers, before it is published.",
  },
  {
    title: "Cheers publishes it",
    body: "Your post goes to your Facebook Page and Instagram account at the time you schedule.",
  },
] as const;

export function FrontDoorPage({ cta }: FrontDoorPageProps) {
  const cards = priceCards();
  const { terms, privacy, dpa } = LEGAL_DOCUMENTS;

  return (
    <div className="min-h-svh" style={{ backgroundColor: "var(--c-paper)", ...inkStyle }}>
      <header className="mx-auto flex max-w-[1040px] items-center justify-between gap-4 px-4 py-5">
        <Image
          src="/brand/cheers-logo-horizontal-480.png"
          alt="Cheers by Orange Jelly"
          width={140}
          height={48}
          priority
        />
        <nav aria-label="Main" className="flex items-center gap-4 text-sm font-medium">
          <a href="#prices" className="hover:underline" style={inkStyle}>
            Prices
          </a>
          <Link href={LOGIN_PATH} className="hover:underline" style={linkStyle}>
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        <section style={{ backgroundColor: "var(--c-ink)" }}>
          <div className="mx-auto max-w-[1040px] space-y-6 px-4 py-16 md:py-20">
            <h1 className="max-w-[640px] text-3xl font-semibold leading-tight text-white md:text-4xl">
              Your venue&apos;s social media, sorted.
            </h1>
            <p className="max-w-[560px] text-base leading-relaxed md:text-lg" style={{ color: "var(--c-paper-2)" }}>
              Cheers is software for planning, writing and publishing social media posts for hospitality venues.
              Create once, and Cheers adapts your content for Facebook and Instagram, so you can focus on running
              your venue.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryCta cta={cta} />
              <Button asChild variant="secondary" size="lg">
                <a href="#prices">See prices</a>
              </Button>
            </div>
          </div>
        </section>

        <Section id="what-it-does" title="What Cheers does">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="rounded-[var(--r-lg)] border p-4"
                style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-line)" }}
              >
                {feature}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="how-it-works" title="How it works">
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="space-y-2 rounded-[var(--r-lg)] border p-5"
                style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-line)" }}
              >
                <p className="text-sm font-semibold" style={linkStyle}>
                  Step {index + 1}
                </p>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p style={mutedStyle}>{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="what-you-need" title="What you need">
          <ul className="list-disc space-y-2 pl-6">
            <li>Admin access to your venue&apos;s Facebook Page.</li>
            <li>For Instagram, a professional Instagram account linked to that Facebook Page.</li>
            <li>
              A card for the free trial. Your first payment is taken on day {TRIAL_DAYS + 1}, unless you cancel
              before then.
            </li>
          </ul>
        </Section>

        <Section id="prices" title="Prices">
          <p style={mutedStyle}>All prices are ex VAT. We add VAT at the UK rate.</p>
          <div className="grid gap-4 md:grid-cols-3">
            {cards.map((card) => (
              <article
                key={card.id}
                aria-labelledby={`plan-${card.id}`}
                className="flex flex-col gap-4 rounded-[var(--r-xl)] border p-5"
                style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-line-2)" }}
              >
                <h3 id={`plan-${card.id}`} className="text-xl font-semibold">
                  {card.name}
                </h3>
                {card.monthly && card.annual ? (
                  <div className="space-y-1">
                    <p className="text-2xl font-semibold">
                      {card.monthly} <span className="text-sm font-normal" style={mutedStyle}>ex VAT</span>
                    </p>
                    <p className="text-sm" style={mutedStyle}>
                      or {card.annual} ex VAT
                    </p>
                  </div>
                ) : (
                  <p className="text-2xl font-semibold">Contact us</p>
                )}
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {card.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {card.monthly ? null : (
                  <p className="mt-auto text-sm">
                    Email <ContactEmail /> or message us on WhatsApp at <ContactWhatsApp />.
                  </p>
                )}
              </article>
            ))}
          </div>
          <p className="text-sm" style={mutedStyle}>
            Each Facebook or Instagram placement counts as a separate published post.
          </p>
          <div
            className="space-y-2 rounded-[var(--r-lg)] border p-5"
            style={{ backgroundColor: "var(--c-orange-tint)", borderColor: "var(--c-orange-soft)" }}
          >
            <h3 className="text-lg font-semibold">Free trial</h3>
            {trialLines().map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </Section>

        <Section id="questions" title="Questions">
          <div className="space-y-3">
            <Question title="Can I cancel?">
              Yes. An owner can cancel at any time in Cheers under Settings, Billing, Manage billing, or by emailing
              us. Cancelling stops the next renewal, and you keep access until the end of the period you have paid for.
            </Question>
            <Question title="Do you give refunds?">
              We do not refund part of a month or year, including on annual plans. The free trial is your chance to
              try Cheers first.
            </Question>
            <Question title="Can I change plan?">
              Yes. An upgrade takes effect straight away. A downgrade takes effect at your next renewal. If you change
              plan during the trial, the trial keeps running and nothing is charged until it ends.
            </Question>
            <Question title="Who writes the posts?">
              Cheers suggests drafts with AI, and AI can get things wrong. You check every post before it is
              published, and you decide what goes out.
            </Question>
            <Question title="Who can sign up?">
              We sell Cheers only to businesses. Each business can have one free trial.
            </Question>
            <Question title="What happens to my data?">
              Our <LegalLink href={privacy.path}>{privacy.title}</LegalLink> explains what we collect and why, and our{" "}
              <LegalLink href={dpa.path}>{dpa.title}</LegalLink> covers the data we handle for your venue. The{" "}
              <LegalLink href={terms.path}>{terms.title}</LegalLink> set out the rest.
            </Question>
          </div>
        </Section>

        <section className="mx-auto max-w-[1040px] px-4 pb-4">
          <div
            className="space-y-4 rounded-[var(--r-xl)] border p-6 text-center"
            style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-line-2)" }}
          >
            <h2 className="text-2xl font-semibold">
              {cta === "trial" ? "Ready to try Cheers?" : "Want to try Cheers?"}
            </h2>
            <div className="flex justify-center">
              <PrimaryCta cta={cta} />
            </div>
            <CtaNote cta={cta} />
          </div>
        </section>
      </main>

      <div className="mx-auto max-w-[1040px] px-4 pb-10">
        <LegalFooter />
        <nav aria-label="More" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/help" className="hover:underline" style={linkStyle}>
            Help
          </Link>
          <Link href={LOGIN_PATH} className="hover:underline" style={linkStyle}>
            Sign in
          </Link>
        </nav>
      </div>
    </div>
  );
}

/** "Start your free trial" only when the switch is on; otherwise "Talk to us" by email. */
function PrimaryCta({ cta }: { cta: FrontDoorCta }) {
  if (cta === "trial") {
    return (
      <Button asChild variant="primary" size="lg">
        <Link href={SIGNUP_PATH}>Start your free trial</Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="primary" size="lg">
      <a href={`mailto:${CONTACT.email}`}>Talk to us</a>
    </Button>
  );
}

function CtaNote({ cta }: { cta: FrontDoorCta }) {
  if (cta === "trial") {
    return (
      <p className="text-sm" style={mutedStyle}>
        Already use Cheers?{" "}
        <Link href={LOGIN_PATH} className="hover:underline" style={linkStyle}>
          Sign in
        </Link>
      </p>
    );
  }
  return (
    <p className="text-sm" style={mutedStyle}>
      Email <ContactEmail /> or message us on WhatsApp at <ContactWhatsApp />.
    </p>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto max-w-[1040px] space-y-5 px-4 py-12">
      <h2 id={`${id}-title`} className="text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details
      className="rounded-[var(--r-lg)] border p-4"
      style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-line)" }}
    >
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <p className="mt-3" style={mutedStyle}>
        {children}
      </p>
    </details>
  );
}
