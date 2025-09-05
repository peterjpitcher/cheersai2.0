'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication failed. Please try again.',
  invalid_request: 'Invalid request. Please retry the connection.',
  invalid_tenant: 'Tenant mismatch detected. Please re-login and retry.',
  token_failed: 'Failed to obtain access token.',
  storage_failed: 'Could not save the connection. Please retry.',
  no_pages: 'No Facebook Pages found for this account.',
  no_instagram_accounts: 'No Instagram Business accounts connected to your Page.',
  oauth_failed: 'OAuth error. Please try again.',
  account_fetch_failed: 'Failed to fetch account data from provider.',
  locations_fetch_failed: 'Failed to fetch locations from Google Business Profile.',
  gmb_connect_failed: 'Failed to start Google Business Profile OAuth.',
  oauth_init_failed: 'Failed to start OAuth flow. Check app credentials.',
  token_exchange_failed: 'Token exchange failed. Check app settings and callback URL.',
  missing_parameters: 'Missing parameters returned from provider.',
  invalid_state: 'State verification failed.',
  state_mismatch: 'CSRF check failed (state mismatch).',
  not_authenticated: 'You must be logged in to connect accounts.',
  no_tenant: 'No tenant found for this user.',
}

const SUCCESS_MESSAGES: Record<string, string> = {
  true: 'Connection successful',
  twitter_connected: 'Twitter account connected successfully',
  google_my_business_connected: 'Google Business Profile connected successfully',
}

export default function ConnectionToasts() {
  const params = useSearchParams()
  const shownRef = useRef(false)

  useEffect(() => {
    if (shownRef.current) return
    const error = params.get('error') || undefined
    const success = params.get('success') || undefined
    const detail = params.get('detail') || undefined

    if (error) {
      let message = ERROR_MESSAGES[error] || `Connection error: ${error}`
      if (detail) {
        try {
          const decoded = Buffer.from(decodeURIComponent(detail), 'base64').toString('utf-8')
          message += ` — ${decoded}`
        } catch {}
      }
      toast.error(message)
      shownRef.current = true
    } else if (success) {
      const message = SUCCESS_MESSAGES[success] || SUCCESS_MESSAGES['true']
      toast.success(message)
      shownRef.current = true
    }
  }, [params])

  return null
}

