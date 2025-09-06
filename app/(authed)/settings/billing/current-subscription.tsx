'use client'

import { useState } from 'react'
import { CreditCard, Calendar, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getBaseUrl } from '@/lib/utils/get-app-url'
type Subscription = { tier: string; status: string; trial_ends_at: string | null }

interface CurrentSubscriptionProps {
  subscription: Subscription | null
  tenantId: string
  planSource?: 'Stripe' | 'Tenant'
}

export function CurrentSubscription({ subscription, tenantId, planSource = 'Tenant' }: CurrentSubscriptionProps) {
  const [managing, setManaging] = useState(false)
  
  const isTrialing = subscription?.status === 'trialing'
  const isActive = subscription?.status === 'active'
  const isCanceled = subscription?.status === 'canceled'
  
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
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
      
      const { url, error } = await response.json()
      
      if (error) {
        toast.error(error)
      } else if (url) {
        window.location.href = url
      }
    } catch (error) {
      toast.error('Failed to open billing portal')
    } finally {
      setManaging(false)
    }
  }
  
  if (!subscription) {
    return (
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-xl font-heading font-bold mb-4">Current Subscription</h2>
        <div className="p-4 bg-gray-50 rounded-medium">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-text-secondary mt-0.5" />
            <div>
              <p className="font-medium mb-1">No Active Subscription</p>
              <p className="text-sm text-text-secondary">
                You're currently on the free trial. Choose a plan below to continue using CheersAI after your trial ends.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="bg-white rounded-large shadow-sm border border-border p-6">
      <h2 className="text-xl font-heading font-bold mb-4">Current Subscription</h2>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-medium">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-primary" />
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
          
          <button
            onClick={handleManageSubscription}
            disabled={managing}
            className="btn-secondary"
          >
            {managing ? 'Loading...' : 'Manage Subscription'}
          </button>
        </div>
        
        <div className="grid md:grid-cols-2 gap-4">
          {isTrialing && subscription.trial_ends_at && (
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-text-secondary mt-0.5" />
              <div>
                <p className="text-sm font-medium">Trial Ends</p>
                <p className="text-sm text-text-secondary">
                  {formatDate(subscription.trial_ends_at)}
                </p>
              </div>
            </div>
          )}
          
          {subscription.current_period_end && (
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-text-secondary mt-0.5" />
              <div>
                <p className="text-sm font-medium">
                  {isCanceled ? 'Access Until' : 'Next Billing Date'}
                </p>
                <p className="text-sm text-text-secondary">
                  {formatDate(subscription.current_period_end)}
                </p>
              </div>
            </div>
          )}
        </div>
        
        {isCanceled && (
          <div className="p-3 bg-warning-light/10 border border-warning rounded-medium">
            <p className="text-sm text-warning">
              Your subscription has been cancelled. You'll retain access until the end of your billing period.
            </p>
          </div>
        )}
      </div>
      
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-text-secondary">
          Manage your subscription, update payment methods, or download invoices through the Stripe billing portal.
        </p>
      </div>
    </div>
  )
}
