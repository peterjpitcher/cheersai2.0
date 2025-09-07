import { getUserAndTenant, getSubscription } from '@/lib/settings/service'
import { BillingPlans } from './billing-plans'
import { CurrentSubscription } from './current-subscription'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function BillingSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const subscription = await getSubscription(tenant.id)
  const planSource = tenant.stripe_customer_id || tenant.stripe_subscription_id ? 'Stripe' : 'Tenant'
  
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-0">
          <CurrentSubscription subscription={subscription} tenantId={tenant.id} planSource={planSource as 'Stripe' | 'Tenant'} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <BillingPlans currentTier={subscription?.tier || 'free'} />
        </CardContent>
      </Card>
    </div>
  )
}
