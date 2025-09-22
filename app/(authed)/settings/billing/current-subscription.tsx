'use client'

import { useState } from 'react'
import { CreditCard, Calendar, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getBaseUrl } from '@/lib/utils/get-app-url'
import { formatDate as formatDateHelper } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
type Subscription = { tier: string; status: string; trial_ends_at: string | null; current_period_end?: string | null }

interface CurrentSubscriptionProps {
  subscription: Subscription | null
  planSource?: 'Stripe' | 'Tenant'
}

export function CurrentSubscription({ subscription, planSource = 'Tenant' }: CurrentSubscriptionProps) {
  const [managing, setManaging] = useState(false)
  
  const isTrialing = subscription?.status === 'trialing'
  const isActive = subscription?.status === 'active'
  const isCanceled = subscription?.status === 'canceled'
  const tier = (subscription?.tier || 'free').toLowerCase()
  const tierStyles: Record<string, { badge: string; border: string; text: string; bg: string }> = {
    free: { badge: 'bg-gray-100 text-gray-800', border: 'border-gray-300', text: 'text-gray-800', bg: 'bg-gray-50' },
    trial: { badge: 'bg-amber-100 text-amber-800', border: 'border-amber-300', text: 'text-amber-800', bg: 'bg-amber-50' },
    starter: { badge: 'bg-blue-100 text-blue-800', border: 'border-blue-300', text: 'text-blue-800', bg: 'bg-blue-50' },
    professional: { badge: 'bg-primary/15 text-primary', border: 'border-primary/40', text: 'text-primary', bg: 'bg-primary/10' },
    pro: { badge: 'bg-primary/15 text-primary', border: 'border-primary/40', text: 'text-primary', bg: 'bg-primary/10' },
    enterprise: { badge: 'bg-purple-100 text-purple-800', border: 'border-purple-300', text: 'text-purple-800', bg: 'bg-purple-50' },
  }
  const style = tierStyles[tier] || tierStyles.free
  
  const formatDateLocal = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return formatDateHelper(dateString)
  }
  
  const handleManageSubscription = async () => {
    setManaging(true)
    
    try {
      const response = await fetch('/api/stripe/create-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          returnUrl: getBaseUrl() + '/settings/billing' 
        })
      })
      
      const json = await response.json()
      const url = json?.data?.url ?? json?.url
      const portalError = json?.error || json?.data?.error
      
      if (portalError) {
        toast.error(portalError)
      } else if (url) {
        window.location.href = url
      }
    } catch {
      toast.error('Failed to open billing portal')
    } finally {
      setManaging(false)
    }
  }
  
  if (!subscription) {
    return (
      <div className="p-6">
        <h2 className="mb-4 font-heading text-xl font-bold">Current Subscription</h2>
        <div className="rounded-medium bg-gray-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 text-text-secondary" />
            <div>
              <p className="mb-1 font-medium">No Active Subscription</p>
              <p className="text-sm text-text-secondary">
                You're currently on the free trial. Choose a plan below to continue using CheersAI after your trial ends.
              </p>
              <div className="mt-3">
                <Button asChild>
                  <a href="/pricing">Select Plan</a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className={`rounded-large border p-6 ${style.border}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold">Current Subscription</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${style.badge}`}>
          {subscription.tier}
        </span>
      </div>
      
      <div className="space-y-4">
        <div className={`flex items-center justify-between rounded-medium p-4 ${style.bg}`}>
          <div className="flex items-center gap-3">
            <CreditCard className={`size-5 ${style.text}`} />
            <div>
              <p className="font-medium capitalize">
                {subscription.tier} Plan
              </p>
              <p className="text-sm text-text-secondary">
                Status: <span className={`font-medium ${
                  isActive ? 'text-success' : 
                  isTrialing ? 'text-warning' : 
                  'text-error'
                }`}>
                  {subscription.status}
                </span>
              </p>
              <p className="text-xs text-text-secondary">Source: {planSource}</p>
            </div>
          </div>
          
          {isActive || isTrialing ? (
            <Button onClick={handleManageSubscription} disabled={managing} variant="secondary">
              {managing ? 'Loading...' : 'Manage Subscription'}
            </Button>
          ) : (
            <Button asChild>
              <a href="/pricing">Select Plan</a>
            </Button>
          )}
        </div>
        
        <div className="grid gap-4 md:grid-cols-2">
          {isTrialing && subscription.trial_ends_at && (
            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 size-4 text-text-secondary" />
              <div>
                <p className="text-sm font-medium">Trial Ends</p>
                <p className="text-sm text-text-secondary">
                  {formatDateLocal(subscription.trial_ends_at)}
                </p>
              </div>
            </div>
          )}
          
          {subscription.current_period_end && (
            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 size-4 text-text-secondary" />
              <div>
                <p className="text-sm font-medium">
                  {isCanceled ? 'Access Until' : 'Next Billing Date'}
                </p>
                <p className="text-sm text-text-secondary">
                  {formatDateLocal(subscription.current_period_end)}
                </p>
              </div>
            </div>
          )}
        </div>
        
        {isCanceled && (
          <div className="rounded-medium border border-warning bg-warning/10 p-3">
            <p className="text-sm text-warning">
              Your subscription has been cancelled. You'll retain access until the end of your billing period.
            </p>
          </div>
        )}
      </div>
      
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs text-text-secondary">
          Manage your subscription, update payment methods, or download invoices through the Stripe billing portal.
        </p>
      </div>
    </div>
  )
}
