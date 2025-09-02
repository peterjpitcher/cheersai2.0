'use client'

import { useState } from 'react'
import { Trash2, CheckCircle, XCircle, Facebook, Twitter } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import type { Database } from '@/lib/types/database'

type SocialAccount = Database['public']['Tables']['social_accounts']['Row']

interface SocialConnectionsListProps {
  connections: SocialAccount[]
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
        const PlatformIcon = connection.platform === 'facebook' ? Facebook : Twitter
        const isProcessing = disconnecting === connection.id || toggling === connection.id
        
        return (
          <div
            key={connection.id}
            className="flex items-center justify-between p-4 border border-border rounded-medium hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-medium flex items-center justify-center ${
                connection.platform === 'facebook' 
                  ? 'bg-blue-100 text-blue-600' 
                  : 'bg-gray-100 text-gray-900'
              }`}>
                <PlatformIcon className="w-5 h-5" />
              </div>
              
              <div>
                <p className="font-medium">
                  {connection.account_name || 'Connected Account'}
                </p>
                <p className="text-sm text-text-secondary">
                  {connection.platform === 'facebook' && connection.page_name 
                    ? `Page: ${connection.page_name}`
                    : connection.platform.charAt(0).toUpperCase() + connection.platform.slice(1)
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
              <button
                onClick={() => handleToggle(connection.id, connection.is_active)}
                disabled={isProcessing}
                className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-medium transition-colors disabled:opacity-50"
              >
                {toggling === connection.id 
                  ? 'Updating...' 
                  : connection.is_active ? 'Deactivate' : 'Activate'
                }
              </button>
              
              <button
                onClick={() => handleDisconnect(connection.id, connection.platform)}
                disabled={isProcessing}
                className="text-sm px-3 py-1 bg-error/10 text-error hover:bg-error/20 rounded-medium transition-colors disabled:opacity-50"
              >
                {disconnecting === connection.id ? (
                  'Disconnecting...'
                ) : (
                  <>
                    <Trash2 className="w-3 h-3 inline mr-1" />
                    Disconnect
                  </>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}