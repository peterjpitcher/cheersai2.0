"use client";

import { useState } from 'react'
import Link from 'next/link'
import Container from '@/components/layout/container'
import { PRICING_TIERS } from '@/lib/stripe/config'
import { Check } from 'lucide-react'

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)

  return (
    <div className="bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
        <Container className="flex items-center justify-between py-4">
          <Link href="/" className="font-heading text-lg font-bold">CheersAI</Link>
          <nav className="hidden gap-6 text-sm sm:flex" aria-label="Primary">
            <Link href="/features" className="text-text-secondary hover:text-primary">Features</Link>
            <Link href="/pricing" className="text-text-secondary hover:text-primary">Pricing</Link>
            <Link href="/help" className="text-text-secondary hover:text-primary">Help</Link>
          </nav>
          <div className="flex gap-2">
            <Link href="/auth/login" className="rounded-md border border-input px-3 py-2 text-sm">Sign In</Link>
            <Link href="/#waitlist" className="rounded-md bg-primary px-3 py-2 text-sm text-white">Join Waitlist</Link>
          </div>
        </Container>
      </header>

      <section className="bg-gradient-to-b from-primary/5 to-transparent">
        <Container className="py-12 text-center md:py-16">
          <h1 className="mb-3 font-heading text-3xl font-bold md:text-5xl">Simple pricing for UK hospitality</h1>
          <p className="mx-auto max-w-2xl text-text-secondary">Start free. Upgrade as you grow. No long-term contracts.</p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border bg-white px-2 py-1 shadow-sm">
            <button
              className={`rounded-full px-3 py-1 text-sm ${!annual ? 'bg-primary text-white' : ''}`}
              onClick={() => setAnnual(false)}
              aria-pressed={!annual}
            >Monthly</button>
            <button
              className={`rounded-full px-3 py-1 text-sm ${annual ? 'bg-primary text-white' : ''}`}
              onClick={() => setAnnual(true)}
              aria-pressed={annual}
            >Annual <span className="text-xs opacity-80">(save 10%)</span></button>
          </div>
        </Container>
      </section>

      <Container className="grid gap-6 pb-16 md:grid-cols-2 lg:grid-cols-4">
        {PRICING_TIERS.map((tier) => (
          <div key={tier.id} className={`rounded-xl border ${tier.popular ? 'border-primary shadow-lg' : 'border-border shadow-sm'} flex flex-col bg-white`}>
            {tier.popular && (
              <div className="rounded-t-xl bg-primary py-1 text-center text-xs font-semibold text-white">Most Popular</div>
            )}
            <div className="flex flex-1 flex-col p-6">
              <h3 className="font-heading text-lg font-bold">{tier.name}</h3>
              <p className="mt-1 text-sm text-text-secondary">{tier.description}</p>
              <div className="mt-4">
                {tier.price === 0 && (
                  <p className="text-3xl font-bold">£0 <span className="text-base font-normal text-text-secondary">/trial</span></p>
                )}
                {typeof tier.price === 'number' && tier.id !== 'free' && (
                  <p className="text-3xl font-bold">
                    £{(annual ? tier.priceAnnual ?? tier.price : tier.priceMonthly ?? tier.price).toFixed(2)}
                    <span className="text-base font-normal text-text-secondary">/month</span>
                  </p>
                )}
                {tier.price === null && (
                  <p className="text-3xl font-bold">Custom</p>
                )}
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 text-primary" />{f}</li>
                ))}
              </ul>
              <div className="mt-6">
                {tier.id === 'free' ? (
                  <Link href="/#waitlist" className="block rounded-md bg-primary px-4 py-2 text-center text-white">Join Waitlist</Link>
                ) : tier.price === null ? (
                  <Link href="/help" className="block rounded-md border border-input px-4 py-2 text-center">{tier.cta}</Link>
                ) : (
                  <Link href="/#waitlist" className="block rounded-md bg-primary px-4 py-2 text-center text-white">Join Waitlist</Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </Container>

      <section className="border-t border-border bg-surface/50">
        <Container className="grid gap-6 py-10 text-sm md:grid-cols-3">
          <div>
            <h4 className="mb-2 font-medium">What’s included</h4>
            <p className="text-text-secondary">All paid plans include multi-platform publishing, scheduling, media library and team access.</p>
          </div>
          <div>
            <h4 className="mb-2 font-medium">Trial details</h4>
            <p className="text-text-secondary">14-day free trial. No credit card required. You can upgrade any time from within the app.</p>
          </div>
          <div>
            <h4 className="mb-2 font-medium">Support</h4>
            <p className="text-text-secondary">Community support on Starter, priority email & WhatsApp support on Professional. Enterprise gets dedicated SLAs.</p>
          </div>
        </Container>
      </section>
    </div>
  )
}
