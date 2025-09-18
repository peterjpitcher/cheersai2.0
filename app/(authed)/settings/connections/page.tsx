import { getUserAndTenant, getSocialConnections } from '@/lib/settings/service'
import { SocialConnectionsList } from './connections-list'
import { AddConnectionButton } from './add-connection'
import ConnectionToasts from './connection-toasts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ConnectionsSettingsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenant } = await getUserAndTenant()
  const socialConnections = await getSocialConnections(tenant.id)
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  
  return (
    <div className="space-y-6">
      <ConnectionToasts />
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        {resolvedSearchParams?.error && (
          <div className="mb-4 rounded-medium border border-error/20 bg-error/5 px-3 py-2 text-sm text-error">
            Connection error: {Array.isArray(resolvedSearchParams.error) ? resolvedSearchParams.error[0] : resolvedSearchParams.error}
          </div>
        )}
        {resolvedSearchParams?.success && (
          <div className="mb-4 rounded-medium border border-success/20 bg-success/5 px-3 py-2 text-sm text-success">
            Connection successful
          </div>
        )}
        <h2 className="mb-2 font-heading text-xl font-bold">Social Media Connections</h2>
        <p className="mb-6 text-sm text-text-secondary">
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
      
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-heading text-lg font-bold">Available Platforms</h2>
        
        <div className="grid gap-4 md:grid-cols-2">
          <PlatformCard
            name="Facebook"
            description="Connect your Facebook Page to publish updates and manage your social presence"
            status="available"
            icon="facebook"
          />
          
          <PlatformCard
            name="Instagram Business"
            description="Share visual content to Instagram through your connected Facebook Page"
            status="available"
            icon="instagram"
          />
          
          {/* Twitter/X removed */}
          
          <PlatformCard
            name="Google Business Profile"
            description="Post updates to your Google Business Profile to improve local visibility"
            status="available"
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
    <div className="rounded-medium border border-border p-4">
      <div className="flex items-start gap-3">
        <div className={`flex size-10 items-center justify-center rounded-medium text-sm font-bold ${
          icon === 'facebook' ? 'bg-blue-100 text-blue-600' :
          icon === 'instagram' ? 'bg-gradient-to-br from-purple-100 to-pink-100 text-pink-600' :
          
          icon === 'google' ? 'bg-green-100 text-green-600' :
          'bg-gray-100 text-gray-600'
        }`}>
          {icon === 'facebook' && 'f'}
          {icon === 'instagram' && 'IG'}
          
          {icon === 'google' && 'G'}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{name}</h3>
            {status === 'coming-soon' && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-text-secondary">
                Coming Soon
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}
