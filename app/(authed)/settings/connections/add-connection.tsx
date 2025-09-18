'use client'

import { useState } from 'react'
import { Plus, Facebook, Building2, Instagram } from 'lucide-react'
import { toast } from 'sonner'
import { getBaseUrl } from '@/lib/utils/get-app-url'
import { Button } from '@/components/ui/button'

interface AddConnectionButtonProps {
  tenantId: string
}

export function AddConnectionButton({ tenantId }: AddConnectionButtonProps) {
  const [showPlatforms, setShowPlatforms] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  
  const handleConnect = async (platform: string) => {
    setConnecting(platform)
    
    try {
      const baseUrl = getBaseUrl()
      const redirectUrl = `${baseUrl}/settings/connections?success=true`
      
      // Initiate OAuth flow
      if (platform === 'facebook') {
        window.location.href = `/api/social/connect/facebook?redirect=${encodeURIComponent(redirectUrl)}`
      } else if (platform === 'instagram') {
        // Instagram uses Facebook OAuth, but we must pass platform for callback routing
        window.location.href = `/api/social/connect/facebook?platform=instagram&redirect=${encodeURIComponent(redirectUrl)}`
      } else if (platform === 'google_my_business') {
        window.location.href = `/api/auth/google-my-business/connect?redirect=${encodeURIComponent(redirectUrl)}`
      } else {
        toast.error('Platform not yet supported')
        setConnecting(null)
      }
    } catch (error) {
      toast.error('Failed to initiate connection')
      setConnecting(null)
    }
  }
  
  return (
    <div>
      {!showPlatforms ? (
        <Button onClick={() => setShowPlatforms(true)} className="flex items-center gap-2">
          <Plus className="size-4" />
          Connect Social Account
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">Select a platform to connect:</p>
          
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleConnect('facebook')}
              disabled={connecting === 'facebook'}
              className="flex items-center gap-2 rounded-medium bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Facebook className="size-4" />
              {connecting === 'facebook' ? 'Connecting...' : 'Facebook'}
            </button>
            
            <button
              onClick={() => handleConnect('instagram')}
              disabled={connecting === 'instagram'}
              className="flex items-center gap-2 rounded-medium bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-white transition-colors hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
              title="Requires Facebook Page with connected Instagram Business account"
            >
              <Instagram className="size-4" />
              {connecting === 'instagram' ? 'Connecting...' : 'Instagram Business'}
            </button>
            {/* Twitter/X removed */}
            
            <button
              onClick={() => handleConnect('google_my_business')}
              disabled={connecting === 'google_my_business'}
              className="flex items-center gap-2 rounded-medium bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              <Building2 className="size-4" />
              {connecting === 'google_my_business' ? 'Connecting...' : 'Google Business Profile'}
            </button>
            
            <button
              onClick={() => setShowPlatforms(false)}
              className="px-4 py-2 text-text-secondary transition-colors hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
