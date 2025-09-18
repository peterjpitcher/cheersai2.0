import { getUserAndTenant, getLogos, getWatermarkSettings } from '@/lib/settings/service'
import { LogoUpload } from './logo-upload'
import { LogoGrid } from './logo-grid'
import { WatermarkForm } from './watermark-form'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function LogoSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const logos = await getLogos(tenant.id)
  const watermarkSettings = await getWatermarkSettings(tenant.id)
  
  return (
    <div className="space-y-6">
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <h2 className="mb-2 font-heading text-xl font-bold">Brand Logos</h2>
        <p className="mb-6 text-sm text-text-secondary">
          Upload and manage your brand logos for use in campaigns and watermarks
        </p>
        
        <LogoUpload tenantId={tenant.id} />
        
        <div className="mt-6">
          <LogoGrid logos={logos} />
        </div>
      </div>
      
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <h2 className="mb-2 font-heading text-xl font-bold">Watermark Settings</h2>
        <p className="mb-6 text-sm text-text-secondary">
          Configure how your logo appears on images
        </p>
        
        <WatermarkForm 
          watermarkSettings={watermarkSettings} 
          logos={logos}
          tenantId={tenant.id} 
        />
      </div>
    </div>
  )
}