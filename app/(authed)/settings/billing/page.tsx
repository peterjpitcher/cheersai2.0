import { getUserAndTenant, getSubscription } from '@/lib/settings/service'
import { BillingPlans } from './billing-plans'
import { CurrentSubscription } from './current-subscription'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function BillingSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const subscription = await getSubscription(tenant.id)
  
  return (
    <div className="space-y-6">
      <CurrentSubscription subscription={subscription} tenantId={tenant.id} />
      <BillingPlans currentTier={subscription?.tier || 'free'} />
    </div>
  )
}