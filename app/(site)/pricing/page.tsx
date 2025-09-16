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
        <Container className="py-4 flex items-center justify-between">
          <Link href="/" className="font-heading font-bold text-lg">CheersAI</Link>
          <nav className="hidden sm:flex gap-6 text-sm" aria-label="Primary">
            <Link href="/features" className="text-text-secondary hover:text-primary">Features</Link>
            <Link href="/pricing" className="text-text-secondary hover:text-primary">Pricing</Link>
            <Link href="/help" className="text-text-secondary hover:text-primary">Help</Link>
          </nav>
          <div className="flex gap-2">
            <Link href="/auth/login" className="px-3 py-2 text-sm border border-input rounded-md">Sign In</Link>
            <Link href="/#waitlist" className="px-3 py-2 text-sm bg-primary text-white rounded-md">Join Waitlist</Link>
          </div>
        </Container>
      </header>

      <section className="bg-gradient-to-b from-primary/5 to-transparent">
        <Container className="py-12 md:py-16 text-center">
          <h1 className="text-3xl md:text-5xl font-heading font-bold mb-3">Simple pricing for UK hospitality</h1>
          <p className="text-text-secondary max-w-2xl mx-auto">Start free. Upgrade as you grow. No long-term contracts.</p>

          <div className="mt-6 inline-flex items-center gap-2 border rounded-full px-2 py-1 bg-white shadow-sm">
            <button
              className={`px-3 py-1 rounded-full text-sm ${!annual ? 'bg-primary text-white' : ''}`}
              onClick={() => setAnnual(false)}
              aria-pressed={!annual}
            >Monthly</button>
            <button
              className={`px-3 py-1 rounded-full text-sm ${annual ? 'bg-primary text-white' : ''}`}
              onClick={() => setAnnual(true)}
              aria-pressed={annual}
            >Annual <span className="text-xs opacity-80">(save 10%)</span></button>
          </div>
        </Container>
      </section>

      <Container className="pb-16 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PRICING_TIERS.map((tier) => (
          <div key={tier.id} className={`rounded-xl border ${tier.popular ? 'border-primary shadow-lg' : 'border-border shadow-sm'} bg-white flex flex-col`}>
            {tier.popular && (
              <div className="text-center text-xs font-semibold bg-primary text-white rounded-t-xl py-1">Most Popular</div>
            )}
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="text-lg font-heading font-bold">{tier.name}</h3>
              <p className="text-sm text-text-secondary mt-1">{tier.description}</p>
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
                  <li key={f} className="flex items-start gap-2"><Check className="w-4 h-4 text-primary mt-0.5" />{f}</li>
                ))}
              </ul>
              <div className="mt-6">
                {tier.id === 'free' ? (
                  <Link href="/#waitlist" className="block text-center py-2 px-4 bg-primary text-white rounded-md">Join Waitlist</Link>
                ) : tier.price === null ? (
                  <Link href="/help" className="block text-center py-2 px-4 border border-input rounded-md">{tier.cta}</Link>
                ) : (
                  <Link href="/#waitlist" className="block text-center py-2 px-4 bg-primary text-white rounded-md">Join Waitlist</Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </Container>

      <section className="border-t border-border bg-surface/50">
        <Container className="py-10 grid md:grid-cols-3 gap-6 text-sm">
          <div>
            <h4 className="font-medium mb-2">What’s included</h4>
            <p className="text-text-secondary">All paid plans include multi-platform publishing, scheduling, media library and team access.</p>
          </div>
          <div>
            <h4 className="font-medium mb-2">Trial details</h4>
            <p className="text-text-secondary">14-day free trial. No credit card required. You can upgrade any time from within the app.</p>
          </div>
          <div>
            <h4 className="font-medium mb-2">Support</h4>
            <p className="text-text-secondary">Community support on Starter, priority email & WhatsApp support on Professional. Enterprise gets dedicated SLAs.</p>
          </div>
        </Container>
      </section>
    </div>
  )
}
