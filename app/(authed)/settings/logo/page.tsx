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
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-xl font-heading font-bold mb-2">Brand Logos</h2>
        <p className="text-text-secondary text-sm mb-6">
          Upload and manage your brand logos for use in campaigns and watermarks
        </p>
        
        <LogoUpload tenantId={tenant.id} />
        
        <div className="mt-6">
          <LogoGrid logos={logos} />
        </div>
      </div>
      
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-xl font-heading font-bold mb-2">Watermark Settings</h2>
        <p className="text-text-secondary text-sm mb-6">
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