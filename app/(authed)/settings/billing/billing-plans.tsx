'use client'

import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getBaseUrl } from '@/lib/utils/get-app-url'

const plans = [
  {
    name: 'Starter',
    tier: 'starter',
    price: '£29',
    period: '/month',
    features: [
      '5 campaigns per month',
      '50 social posts per month',
      '2 team members',
      'Basic AI content generation',
      'Email support',
      '100MB media storage',
    ],
  },
  {
    name: 'Professional',
    tier: 'professional',
    price: '£44.99',
    period: '/month',
    popular: true,
    features: [
      '20 campaigns per month',
      '200 social posts per month',
      '5 team members',
      'Advanced AI with brand voice',
      'Priority support',
      '1GB media storage',
      'Custom watermarks',
    ],
  },
  {
    name: 'Enterprise',
    tier: 'enterprise',
    price: 'Custom',
    period: '',
    features: [
      'Unlimited campaigns',
      'Unlimited posts',
      'Unlimited team members',
      'Custom AI training',
      'Dedicated support',
      'Unlimited storage',
      'API access',
      'Custom integrations',
    ],
  },
]

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
      
      const { url, error } = await response.json()
      
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
    <div className="bg-white rounded-large shadow-sm border border-border p-6">
      <h2 className="text-xl font-heading font-bold mb-2">Available Plans</h2>
      <p className="text-text-secondary text-sm mb-6">
        Choose the plan that best fits your business needs
      </p>
      
      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isCurrent = plan.tier === currentTier
          
          return (
            <div
              key={plan.tier}
              className={`relative rounded-large border-2 p-6 ${
                isCurrent ? (tierStyles[plan.tier]?.border || 'border-primary') : plan.popular ? 'border-primary shadow-lg' : 'border-border'
              }`}
            >
              <div className="absolute top-4 right-4">
                {isCurrent && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide ${tierStyles[plan.tier]?.badge || 'bg-primary/15 text-primary'}`}>
                    Current
                  </span>
                )}
              </div>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-white px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Most Popular
                  </span>
                </div>
              )}
              
              <div className="text-center mb-6">
                <h3 className="text-lg font-heading font-bold mb-2">
                  {plan.name}
                </h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  {plan.period && (
                    <span className="text-text-secondary">{plan.period}</span>
                  )}
                </div>
              </div>
              
              <ul className="space-y-3 mb-6">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <button
                onClick={() => handleSelectPlan(plan.tier)}
                disabled={isCurrent || upgrading === plan.tier}
                className={`w-full ${
                  isCurrent
                    ? 'btn-secondary opacity-50 cursor-not-allowed'
                    : plan.popular
                    ? 'btn-primary'
                    : 'btn-secondary'
                }`}
              >
                {isCurrent
                  ? 'Current Plan'
                  : upgrading === plan.tier
                  ? 'Loading...'
                  : plan.tier === 'enterprise'
                  ? 'Contact Sales'
                  : currentTier === 'free' || currentTier === 'trial'
                  ? 'Start Plan'
                  : 'Switch Plan'}
              </button>
            </div>
          )
        })}
      </div>
      
      <div className="mt-6 pt-6 border-t border-border">
        <p className="text-xs text-text-secondary text-center">
          All prices are in GBP and exclude VAT. Plans can be changed or cancelled at any time.
        </p>
      </div>
    </div>
  )
}
