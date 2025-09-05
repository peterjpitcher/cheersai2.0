import { getUserAndTenant, getSocialConnections } from '@/lib/settings/service'
import { SocialConnectionsList } from './connections-list'
import { AddConnectionButton } from './add-connection'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ConnectionsSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const socialConnections = await getSocialConnections(tenant.id)
  
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-xl font-heading font-bold mb-2">Social Media Connections</h2>
        <p className="text-text-secondary text-sm mb-6">
          Connect your social media accounts to publish content directly from CheersAI
        </p>
        
        <div className="mb-6">
          <AddConnectionButton tenantId={tenant.id} />
        </div>
        
        <SocialConnectionsList 
          connections={socialConnections} 
          tenantId={tenant.id}
        />
      </div>
      
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-lg font-heading font-bold mb-4">Available Platforms</h2>
        
        <div className="grid md:grid-cols-2 gap-4">
          <PlatformCard
            name="Facebook & Instagram"
            description="Connect your Facebook Page to publish to both Facebook and Instagram Business accounts"
            status="available"
            icon="facebook"
          />
          
          <PlatformCard
            name="Twitter/X"
            description="Post updates directly to your Twitter/X account"
            status="available"
            icon="twitter"
          />
          
          <PlatformCard
            name="LinkedIn"
            description="Share professional updates to your LinkedIn company page"
            status="coming-soon"
            icon="linkedin"
          />
          
          <PlatformCard
            name="Google My Business"
            description="Post updates to your Google Business Profile"
            status="coming-soon"
            icon="google"
          />
        </div>
      </div>
    </div>
  )
}

function PlatformCard({ 
  name, 
  description, 
  status, 
  icon 
}: { 
  name: string
  description: string
  status: 'available' | 'coming-soon'
  icon: string 
}) {
  return (
    <div className="p-4 border border-border rounded-medium">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-medium flex items-center justify-center ${
          icon === 'facebook' ? 'bg-blue-100 text-blue-600' :
          icon === 'twitter' ? 'bg-gray-100 text-gray-900' :
          icon === 'linkedin' ? 'bg-blue-100 text-blue-700' :
          'bg-green-100 text-green-600'
        }`}>
          {icon === 'facebook' && 'f'}
          {icon === 'twitter' && 'X'}
          {icon === 'linkedin' && 'in'}
          {icon === 'google' && 'G'}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{name}</h3>
            {status === 'coming-soon' && (
              <span className="text-xs bg-gray-100 text-text-secondary px-2 py-0.5 rounded-full">
                Coming Soon
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary mt-1">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}