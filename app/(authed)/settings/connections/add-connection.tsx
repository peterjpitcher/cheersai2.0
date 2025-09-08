'use client'

import { useState } from 'react'
import { Plus, Facebook, Twitter, Building2, Instagram } from 'lucide-react'
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
      } else if (platform === 'twitter') {
        window.location.href = `/api/social/connect/twitter?redirect=${encodeURIComponent(redirectUrl)}`
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
          <Plus className="w-4 h-4" />
          Connect Social Account
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">Select a platform to connect:</p>
          
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleConnect('facebook')}
              disabled={connecting === 'facebook'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Facebook className="w-4 h-4" />
              {connecting === 'facebook' ? 'Connecting...' : 'Facebook'}
            </button>
            
            <button
              onClick={() => handleConnect('instagram')}
              disabled={connecting === 'instagram'}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-medium hover:from-purple-700 hover:to-pink-700 transition-colors disabled:opacity-50"
              title="Requires Facebook Page with connected Instagram Business account"
            >
              <Instagram className="w-4 h-4" />
              {connecting === 'instagram' ? 'Connecting...' : 'Instagram Business'}
            </button>
            
            <button
              onClick={() => handleConnect('twitter')}
              disabled={connecting === 'twitter'}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <Twitter className="w-4 h-4" />
              {connecting === 'twitter' ? 'Connecting...' : 'Twitter/X'}
            </button>
            
            <button
              onClick={() => handleConnect('google_my_business')}
              disabled={connecting === 'google_my_business'}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-medium hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Building2 className="w-4 h-4" />
              {connecting === 'google_my_business' ? 'Connecting...' : 'Google Business Profile'}
            </button>
            
            <button
              onClick={() => setShowPlatforms(false)}
              className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
