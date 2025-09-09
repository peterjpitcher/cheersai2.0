'use client'

import { useState } from 'react'
import { Trash2, CheckCircle, XCircle, Facebook, Twitter, Instagram, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import type { Database } from '@/lib/types/database'
import VerifyButton from '@/components/connections/verify-button'

type SocialConnection = Database['public']['Tables']['social_connections']['Row']

interface SocialConnectionsListProps {
  connections: SocialConnection[]
  tenantId: string
}

export function SocialConnectionsList({ connections, tenantId }: SocialConnectionsListProps) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const router = useRouter()
  
  const handleDisconnect = async (accountId: string, platform: string) => {
    if (!confirm(`Are you sure you want to disconnect this ${platform} account?`)) {
      return
    }
    
    setDisconnecting(accountId)
    
    try {
      const response = await fetch(`/api/social/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId })
      })
      
      const { error } = await response.json()
      
      if (error) {
        toast.error(error)
      } else {
        toast.success('Account disconnected successfully')
        router.refresh()
      }
    } catch (error) {
      toast.error('Failed to disconnect account')
    } finally {
      setDisconnecting(null)
    }
  }
  
  const handleToggle = async (accountId: string, currentStatus: boolean) => {
    setToggling(accountId)
    
    try {
      const response = await fetch(`/api/social/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accountId,
          isActive: !currentStatus 
        })
      })
      
      const { error } = await response.json()
      
      if (error) {
        toast.error(error)
      } else {
        toast.success(currentStatus ? 'Account deactivated' : 'Account activated')
        router.refresh()
      }
    } catch (error) {
      toast.error('Failed to update account status')
    } finally {
      setToggling(null)
    }
  }
  
  if (connections.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-medium">
        <p className="text-text-secondary">No social accounts connected yet</p>
        <p className="text-sm text-text-secondary mt-1">
          Connect your first social media account to start publishing
        </p>
      </div>
    )
  }
  
  return (
    <div className="space-y-3">
      {connections.map((connection) => {
        // Determine platform icon
        const PlatformIcon = 
          connection.platform === 'facebook' ? Facebook :
          connection.platform === 'instagram' || connection.platform === 'instagram_business' ? Instagram :
          connection.platform === 'google_my_business' ? Building2 :
          Twitter;
        
        const isProcessing = disconnecting === connection.id || toggling === connection.id
        
        // Platform-specific styling
        const platformStyles = {
          facebook: 'bg-blue-100 text-blue-600',
          instagram: 'bg-gradient-to-br from-purple-100 to-pink-100 text-pink-600',
          instagram_business: 'bg-gradient-to-br from-purple-100 to-pink-100 text-pink-600',
          twitter: 'bg-gray-100 text-gray-900',
          google_my_business: 'bg-green-100 text-green-600'
        };
        
        // Get platform display name
        const getPlatformName = (platform: string) => {
          const names: { [key: string]: string } = {
            facebook: 'Facebook',
            instagram: 'Instagram',
            instagram_business: 'Instagram Business',
            twitter: 'Twitter/X',
            google_my_business: 'Google Business Profile'
          };
          return names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
        };
        
        return (
          <div
            key={connection.id}
            className="flex items-center justify-between p-4 border border-border rounded-medium hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-medium flex items-center justify-center ${
                platformStyles[connection.platform as keyof typeof platformStyles] || 'bg-gray-100 text-gray-600'
              }`}>
                <PlatformIcon className="w-5 h-5" />
              </div>
              
              <div>
                <p className="font-medium">
                  {connection.account_name || 'Connected Account'}
                </p>
                <p className="text-sm text-text-secondary">
                  {connection.page_name 
                    ? `${getPlatformName(connection.platform)} • Page: ${connection.page_name}`
                    : getPlatformName(connection.platform)
                  }
                </p>
              </div>
              
              <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                connection.is_active
                  ? 'bg-success-light/10 text-success'
                  : 'bg-gray-100 text-text-secondary'
              }`}>
                {connection.is_active ? (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    Active
                  </>
                ) : (
                  <>
                    <XCircle className="w-3 h-3" />
                    Inactive
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <VerifyButton 
                connectionId={connection.id} 
                lastVerifiedAt={(connection as any).verified_at}
                verifyStatus={(connection as any).verify_status}
              />
              <Button onClick={() => handleToggle(connection.id, !!connection.is_active)} loading={toggling === connection.id} size="sm" variant="secondary">
                {connection.is_active ? 'Deactivate' : 'Activate'}
              </Button>
              
              <Button onClick={() => handleDisconnect(connection.id, connection.platform)} loading={disconnecting === connection.id} size="sm" variant="destructive">
                <Trash2 className="w-3 h-3 inline mr-1" />
                Disconnect
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
