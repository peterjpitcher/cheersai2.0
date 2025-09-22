import { getUserAndTenant, getBrandProfile } from '@/lib/settings/service'
import { BrandForm } from './brand-form'
import BrandLogo from '@/components/ui/BrandLogo'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function BrandSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const brandProfile = await getBrandProfile(tenant.id)

  const completeness = (() => {
    const fields = [
      brandProfile?.brand_voice,
      brandProfile?.target_audience,
      brandProfile?.brand_identity,
      brandProfile?.primary_color,
      // Optional fields like website_url/phone are not guaranteed by types
    ]
    const score = fields.filter(Boolean).length
    if (score >= 4) return { label: 'Complete', tone: 'bg-green-100 text-green-800 border-green-200' }
    if (score >= 2) return { label: 'Good', tone: 'bg-amber-100 text-amber-800 border-amber-200' }
    return { label: 'Basic', tone: 'bg-gray-100 text-gray-800 border-gray-200' }
  })()

  return (
    <div className="space-y-6">
      {/* Snapshot */}
      <div className="flex items-center justify-between gap-4 rounded-large border border-border bg-white p-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo variant="header" className="max-h-11 h-auto w-auto" />
          <div className="min-w-0">
            <div className="truncate font-heading font-semibold">{tenant.name || 'Your Venue'}</div>
            <div className="truncate text-xs text-text-secondary">Used to guide AI tone, content and scheduling</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Colour</span>
            <span
              className="inline-block size-5 rounded-full border border-border"
              style={{ backgroundColor: brandProfile?.primary_color || '#E74E2B' }}
            />
          </div>
          <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${completeness.tone}`}>
            {completeness.label}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <h2 className="mb-2 font-heading text-xl font-bold">Brand Identity</h2>
        <p className="mb-6 text-sm text-text-secondary">
          Define your brand voice, audience and visuals to help AI create on‑brand content.
        </p>
        <BrandForm brandProfile={brandProfile} tenantId={tenant.id} />
      </div>
    </div>
  )
}
