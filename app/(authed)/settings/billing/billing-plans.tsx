'use client'

import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getBaseUrl } from '@/lib/utils/get-app-url'
import { Button } from '@/components/ui/button'
import { PRICING_TIERS } from '@/lib/stripe/config'

const plans = PRICING_TIERS
  .filter((t) => t.id !== 'free')
  .map((t) => ({
    name: t.name,
    // Accept legacy 'professional' id in API; getTierById maps it to 'pro'
    tier: t.id === 'pro' ? 'professional' : t.id,
    price:
      typeof t.price === 'number'
        ? `£${(t.priceMonthly ?? t.price).toFixed(2)}`
        : 'Custom',
    period: typeof t.price === 'number' ? '/month' : '',
    popular: !!t.popular,
    features: t.features.slice(0, 6),
  }))

interface BillingPlansProps {
  currentTier: string
}

export function BillingPlans({ currentTier }: BillingPlansProps) {
  const [upgrading, setUpgrading] = useState<string | null>(null)
  const tierStyles: Record<string, { border: string; badge: string }> = {
    starter: { border: 'border-blue-300', badge: 'bg-blue-100 text-blue-800' },
    professional: { border: 'border-primary/40', badge: 'bg-primary/15 text-primary' },
    enterprise: { border: 'border-purple-300', badge: 'bg-purple-100 text-purple-800' },
  }
  
  const handleSelectPlan = async (tier: string) => {
    if (tier === currentTier) {
      toast.info('You are already on this plan')
      return
    }
    
    if (tier === 'enterprise') {
      window.location.href = 'mailto:sales@cheersai.com?subject=Enterprise Plan Inquiry'
      return
    }
    
    setUpgrading(tier)
    
    try {
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          successUrl: getBaseUrl() + '/settings/billing?success=true',
          cancelUrl: getBaseUrl() + '/settings/billing',
        }),
      })
      
      const json = await response.json()
      const url = json?.data?.url ?? json?.url
      const error = json?.error || json?.data?.error
      
      if (error) {
        toast.error(error)
      } else if (url) {
        window.location.href = url
      }
    } catch (error) {
      toast.error('Failed to start checkout. Please try again.')
    } finally {
      setUpgrading(null)
    }
  }
  
  return (
    <div className="rounded-large border border-border bg-white p-6 shadow-sm">
      <h2 className="mb-2 font-heading text-xl font-bold">Available Plans</h2>
      <p className="mb-6 text-sm text-text-secondary">
        Choose the plan that best fits your business needs
      </p>
      
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.tier === currentTier
          
          return (
            <div
              key={plan.tier}
              className={`relative rounded-large border-2 p-6 ${
                isCurrent ? (tierStyles[plan.tier]?.border || 'border-primary') : plan.popular ? 'border-primary shadow-lg' : 'border-border'
              }`}
            >
              <div className="absolute right-4 top-4">
                {isCurrent && (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tierStyles[plan.tier]?.badge || 'bg-primary/15 text-primary'}`}>
                    Current
                  </span>
                )}
              </div>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
                    <Sparkles className="size-3" />
                    Most Popular
                  </span>
                </div>
              )}
              
              <div className="mb-6 text-center">
                <h3 className="mb-2 font-heading text-lg font-bold">
                  {plan.name}
                </h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  {plan.period && (
                    <span className="text-text-secondary">{plan.period}</span>
                  )}
                </div>
              </div>
              
              <ul className="mb-6 space-y-3">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <Button onClick={() => handleSelectPlan(plan.tier)} disabled={isCurrent || upgrading === plan.tier} className="w-full">
                {isCurrent
                  ? 'Current Plan'
                  : upgrading === plan.tier
                  ? 'Loading...'
                  : plan.tier === 'enterprise'
                  ? 'Contact Sales'
                  : currentTier === 'free' || currentTier === 'trial'
                  ? 'Start Plan'
                  : 'Switch Plan'}
              </Button>
            </div>
          )
        })}
      </div>
      
      <div className="mt-6 border-t border-border pt-6">
        <p className="text-center text-xs text-text-secondary">
          All prices are in GBP and exclude VAT. Plans can be changed or cancelled at any time.
        </p>
      </div>
    </div>
  )
}
