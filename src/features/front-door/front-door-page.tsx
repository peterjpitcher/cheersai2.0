import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  Images,
  Link2,
  LockKeyhole,
  MessageCircle,
  PartyPopper,
  PenLine,
  Plus,
  Repeat,
  ScrollText,
  Send,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import {
  AUDIENCE_SECTION,
  audiences,
  CLOSING,
  FAQ_SECTION,
  FEATURES_SECTION,
  GUIDES_TEASER,
  HERO,
  heroTrialNote,
  homeFaq,
  homeFeatures,
  HOW_IT_WORKS,
  otherVenueNote,
  PRICING_SECTION,
  TRUST_SECTION,
  trustPoints,
  whatsappUrl,
  whatYouNeed,
  type FaqItem,
  type FeatureIcon,
  type TrustIcon,
} from '@/content/homepage';
import type { Guide } from '@/content/guides/types';
import { PlannerIllustration } from '@/features/front-door/planner-illustration';
import { priceCards, trialLines, type PriceCard } from '@/features/front-door/pricing';
import { GuideCard } from '@/features/guides/guide-card';
import { LOGIN_PATH, PrimaryCta, SECONDARY_ON_DARK, SECONDARY_ON_LIGHT } from '@/features/marketing/cta';
import { JsonLd } from '@/features/marketing/json-ld';
import { RichTextView } from '@/features/marketing/rich-text';
import { SiteFooter } from '@/features/marketing/site-footer';
import { SiteHeader } from '@/features/marketing/site-header';
import { CONTACT } from '@/lib/legal/company';
import { homeJsonLd } from '@/lib/marketing/structured-data';
import type { FrontDoorCta } from '@/lib/signup/front-door';

/**
 * The public homepage at `/` (SPEC-homepage-and-guides, building on
 * SPEC-self-serve-signup §4.1).
 *
 * The words live in src/content/homepage.ts and every price in PLANS. It
 * never mentions paid ads, tournaments or the management-app import: new
 * venues do not get them. No cookies and no client script.
 *
 * `cta` follows the sign-up switch: "trial" offers "Start your free trial";
 * anything else offers "Talk to us" with the email and WhatsApp contacts.
 * `guidesHref` and `latestGuides` are empty unless the guides are public.
 */

export interface FrontDoorPageProps {
  cta: FrontDoorCta;
  guidesHref: string | null;
  latestGuides: readonly Guide[];
}

const FEATURE_ICONS: Record<FeatureIcon, LucideIcon> = {
  voice: PenLine,
  platforms: Send,
  planner: CalendarDays,
  publishing: BadgeCheck,
  events: PartyPopper,
  weekly: Repeat,
  library: Images,
  link: Link2,
  team: Users,
};

const TRUST_ICONS: Record<TrustIcon, LucideIcon> = {
  company: Building2,
  people: MessageCircle,
  security: LockKeyhole,
  terms: ScrollText,
};

const CONTAINER = 'mx-auto w-full max-w-[1160px] px-4 sm:px-6';
const EYEBROW = 'font-mono text-xs font-medium uppercase tracking-[0.14em]';

export function FrontDoorPage({ cta, guidesHref, latestGuides }: FrontDoorPageProps): React.JSX.Element {
  const faq = homeFaq();

  return (
    <div className="min-h-svh bg-paper text-ink">
      <SiteHeader cta={cta} guidesHref={guidesHref} />
      <main id="main">
        <JsonLd data={homeJsonLd(faq)} />
        <Hero cta={cta} />
        <HowItWorks />
        <Features />
        <Audiences />
        <Pricing cta={cta} />
        {guidesHref && latestGuides.length ? <GuidesTeaser guidesHref={guidesHref} guides={latestGuides} /> : null}
        <Questions faq={faq} />
        <Trust />
        <Closing cta={cta} />
      </main>
      <SiteFooter guidesHref={guidesHref} />
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  intro,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
}): React.JSX.Element {
  return (
    <div className="max-w-[640px]">
      <p className={`${EYEBROW} text-orange-hi`}>{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
        {title}
      </h2>
      {intro ? <p className="mt-4 text-lg leading-relaxed text-ink-2">{intro}</p> : null}
    </div>
  );
}

function Hero({ cta }: { cta: FrontDoorCta }): React.JSX.Element {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-ink">
      <div aria-hidden="true" className="site-grid pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden="true" className="site-glow pointer-events-none absolute inset-0 -z-10" />
      <div
        className={`${CONTAINER} grid items-center gap-12 pb-16 pt-8 sm:pb-20 sm:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pb-28 lg:pt-16`}
      >
        <div className="motion-safe:animate-slide-up">
          <p className={`${EYEBROW} text-orange`}>{HERO.eyebrow}</p>
          <h1
            id="hero-title"
            className="mt-5 text-4xl font-semibold leading-[1.06] tracking-[-0.03em] text-white sm:text-5xl lg:text-[3.6rem]"
          >
            {HERO.title} <span className="block text-orange">{HERO.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-[560px] text-lg leading-relaxed text-[var(--c-line-2)]">{HERO.intro}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryCta cta={cta} />
            <a href="#how-it-works" className={SECONDARY_ON_DARK}>
              {HERO.secondaryCta}
            </a>
          </div>
          {cta === 'trial' ? (
            <p className="mt-4 text-sm text-[var(--c-ink-4)]">{heroTrialNote()}</p>
          ) : (
            <p className="mt-4 text-sm text-[var(--c-ink-4)]">
              Email{' '}
              <a href={`mailto:${CONTACT.email}`} className="text-white underline underline-offset-4">
                {CONTACT.email}
              </a>{' '}
              or message us on WhatsApp at{' '}
              <a href={whatsappUrl()} className="text-white underline underline-offset-4" rel="noopener noreferrer">
                {CONTACT.whatsappDisplay}
              </a>
              .
            </p>
          )}
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--c-line-2)]">
            {HERO.points.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <Check aria-hidden="true" className="h-4 w-4 text-orange" strokeWidth={2.5} />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <PlannerIllustration />
      </div>
    </section>
  );
}

function HowItWorks(): React.JSX.Element {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-4 bg-paper py-16 sm:py-24">
      <div className={CONTAINER}>
        <SectionHeading
          id="how-it-works-title"
          eyebrow={HOW_IT_WORKS.eyebrow}
          title={HOW_IT_WORKS.heading}
          intro={HOW_IT_WORKS.intro}
        />
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.steps.map((step, index) => (
            <li key={step.title} className="rounded-[var(--r-xl)] border border-line bg-card p-6">
              <span aria-hidden="true" className="font-mono text-sm font-semibold text-orange-hi">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-lg font-semibold leading-snug text-ink">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features(): React.JSX.Element {
  return (
    <section aria-labelledby="features-title" className="bg-card py-16 sm:py-24">
      <div className={`${CONTAINER} grid gap-12 lg:grid-cols-12`}>
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-8">
            <SectionHeading
              id="features-title"
              eyebrow={FEATURES_SECTION.eyebrow}
              title={FEATURES_SECTION.heading}
              intro={FEATURES_SECTION.intro}
            />
          </div>
        </div>
        <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:col-span-8">
          {homeFeatures().map((feature) => {
            const Icon = FEATURE_ICONS[feature.icon];
            return (
              <li key={feature.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--r-lg)] bg-orange-soft text-orange-hi">
                  <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold leading-snug text-ink">{feature.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{feature.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Audiences(): React.JSX.Element {
  return (
    <section aria-labelledby="audience-title" className="border-y border-orange-soft bg-orange-tint py-16 sm:py-20">
      <div className={CONTAINER}>
        <SectionHeading
          id="audience-title"
          eyebrow={AUDIENCE_SECTION.eyebrow}
          title={AUDIENCE_SECTION.heading}
          intro={AUDIENCE_SECTION.intro}
        />
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {audiences().map((audience) => (
            <li key={audience.type} className="rounded-[var(--r-xl)] border border-orange-soft bg-card p-5">
              <h3 className={`${EYEBROW} text-orange-hi`}>{audience.heading}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{audience.examples}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-ink-2">{otherVenueNote()}</p>
      </div>
    </section>
  );
}

function PriceCardView({ card, cta }: { card: PriceCard; cta: FrontDoorCta }): React.JSX.Element {
  const priced = card.monthlyAmount !== null && card.monthly !== null && card.annual !== null;
  return (
    <article
      aria-labelledby={`plan-${card.id}`}
      className="flex flex-col rounded-[var(--r-2xl)] border border-line-2 bg-card p-6 sm:p-7"
    >
      <h3 id={`plan-${card.id}`} className="text-xl font-semibold text-ink">
        {card.name}
      </h3>
      {priced ? (
        <div className="mt-4 space-y-2">
          <p className="text-ink">
            <span className="text-4xl font-semibold tracking-[-0.02em]">{card.monthlyAmount}</span>{' '}
            <span className="text-sm text-ink-2">a month ex VAT</span>
          </p>
          <p className="text-sm text-ink-2">or {card.annual} ex VAT</p>
          {card.yearlySaving ? (
            <p className="inline-flex rounded-[var(--r-pill)] bg-orange-soft px-2.5 py-1 text-xs font-semibold text-orange-hi">
              Save {card.yearlySaving}% when you pay yearly
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-4xl font-semibold tracking-[-0.02em] text-ink">Contact us</p>
          <p className="text-sm text-ink-2">For groups running several venues.</p>
        </div>
      )}
      <ul className="mt-6 space-y-2.5 text-[15px] text-ink-2">
        {card.includes.map((line) => (
          <li key={line} className="flex gap-2.5">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-orange-hi" strokeWidth={2.5} />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-7">
        {priced ? (
          <PrimaryCta cta={cta} size="block" />
        ) : (
          <div className="space-y-3">
            <a href={`mailto:${CONTACT.email}`} className={`${SECONDARY_ON_LIGHT} w-full`}>
              Email us
            </a>
            <p className="text-sm text-ink-2">
              Or message us on WhatsApp at{' '}
              <a
                href={whatsappUrl()}
                className="font-medium text-orange-hi underline underline-offset-[3px]"
                rel="noopener noreferrer"
              >
                {CONTACT.whatsappDisplay}
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function Pricing({ cta }: { cta: FrontDoorCta }): React.JSX.Element {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-4 bg-paper py-16 sm:py-24">
      <div className={CONTAINER}>
        <SectionHeading id="pricing-title" eyebrow={PRICING_SECTION.eyebrow} title={PRICING_SECTION.heading} />
        <p className="mt-4 max-w-[640px] text-lg leading-relaxed text-ink-2">
          {PRICING_SECTION.intro} {PRICING_SECTION.vat}
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {priceCards().map((card) => (
            <PriceCardView key={card.id} card={card} cta={cta} />
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-2">{PRICING_SECTION.placements}</p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-[var(--r-xl)] border border-orange-soft bg-orange-tint p-6">
            <h3 className="text-lg font-semibold text-ink">Free trial</h3>
            <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-ink-2">
              {trialLines().map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
          <div className="rounded-[var(--r-xl)] border border-line bg-card p-6">
            <h3 className="text-lg font-semibold text-ink">What you need</h3>
            <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-ink-2">
              {whatYouNeed().map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-orange-hi" strokeWidth={2.5} />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function GuidesTeaser({ guidesHref, guides }: { guidesHref: string; guides: readonly Guide[] }): React.JSX.Element {
  return (
    <section aria-labelledby="guides-title" className="bg-card py-16 sm:py-24">
      <div className={CONTAINER}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            id="guides-title"
            eyebrow={GUIDES_TEASER.eyebrow}
            title={GUIDES_TEASER.heading}
            intro={GUIDES_TEASER.intro}
          />
          <Link href={guidesHref} className={SECONDARY_ON_LIGHT}>
            {GUIDES_TEASER.link}
          </Link>
        </div>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {guides.map((guide) => (
            <li key={guide.slug} className="flex">
              <GuideCard guide={guide} headingLevel="h3" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Questions({ faq }: { faq: readonly FaqItem[] }): React.JSX.Element {
  return (
    <section id="questions" aria-labelledby="questions-title" className="scroll-mt-4 bg-card py-16 sm:py-24">
      <div className={`${CONTAINER} grid gap-10 lg:grid-cols-12`}>
        <div className="lg:col-span-4">
          <SectionHeading id="questions-title" eyebrow={FAQ_SECTION.eyebrow} title={FAQ_SECTION.heading} />
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            Something else? Email{' '}
            <a href={`mailto:${CONTACT.email}`} className="font-medium text-orange-hi underline underline-offset-[3px]">
              {CONTACT.email}
            </a>{' '}
            or message us on WhatsApp at{' '}
            <a
              href={whatsappUrl()}
              className="font-medium text-orange-hi underline underline-offset-[3px]"
              rel="noopener noreferrer"
            >
              {CONTACT.whatsappDisplay}
            </a>
            .
          </p>
        </div>
        <div className="divide-y divide-line border-y border-line lg:col-span-8">
          {faq.map((item) => (
            <details key={item.question} className="group" data-faq>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <span data-faq-question>{item.question}</span>
                <Plus
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-orange-hi transition-transform duration-200 group-open:rotate-45"
                  strokeWidth={2}
                />
              </summary>
              <p data-faq-answer className="pb-6 pr-9 text-[15px] leading-relaxed text-ink-2">
                <RichTextView value={item.answer} />
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust(): React.JSX.Element {
  return (
    <section aria-labelledby="trust-title" className="bg-paper py-16 sm:py-24">
      <div className={CONTAINER}>
        <SectionHeading id="trust-title" eyebrow={TRUST_SECTION.eyebrow} title={TRUST_SECTION.heading} />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trustPoints().map((point) => {
            const Icon = TRUST_ICONS[point.icon];
            return (
              <li key={point.title} className="rounded-[var(--r-xl)] border border-line bg-card p-6">
                <Icon aria-hidden="true" className="h-6 w-6 text-orange-hi" strokeWidth={1.75} />
                <h3 className="mt-4 text-base font-semibold text-ink">{point.title}</h3>
                <p className="mt-2 break-words text-[15px] leading-relaxed text-ink-2">
                  <RichTextView value={point.body} />
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Closing({ cta }: { cta: FrontDoorCta }): React.JSX.Element {
  const trial = cta === 'trial';
  return (
    <section aria-labelledby="closing-title" className="relative isolate overflow-hidden bg-ink py-16 sm:py-24">
      <div aria-hidden="true" className="site-glow pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto max-w-[760px] px-4 text-center sm:px-6">
        <h2 id="closing-title" className="text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
          {trial ? CLOSING.trialHeading : CLOSING.talkHeading}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-[var(--c-line-2)]">
          {trial ? CLOSING.trialText : CLOSING.talkText}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PrimaryCta cta={cta} />
          {trial ? (
            <Link href={LOGIN_PATH} className={SECONDARY_ON_DARK}>
              Sign in
            </Link>
          ) : (
            <a href={whatsappUrl()} className={SECONDARY_ON_DARK} rel="noopener noreferrer">
              WhatsApp {CONTACT.whatsappDisplay}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
