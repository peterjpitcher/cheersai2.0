import { getUserAndTenant, getBrandProfile } from '@/lib/settings/service'
import { BrandForm } from './brand-form'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function BrandSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const brandProfile = await getBrandProfile(tenant.id)
  
  return (
    <div className="bg-white rounded-large shadow-sm border border-border p-6">
      <h2 className="text-xl font-heading font-bold mb-2">Brand Identity</h2>
      <p className="text-text-secondary text-sm mb-6">
        Define your brand voice, target audience, and identity to help AI create more relevant content
      </p>
      <BrandForm brandProfile={brandProfile} tenantId={tenant.id} />
    </div>
  )
}
