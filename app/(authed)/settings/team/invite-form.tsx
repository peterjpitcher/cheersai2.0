'use client'

import { useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { toast } from 'sonner'
import { inviteTeamMember } from './actions'

interface InviteFormProps {
  tenantId: string
  currentPlan: string
  currentMemberCount: number
}

const PLAN_LIMITS = {
  trial: 1,
  free: 1,
  starter: 2,
  professional: 5,
  enterprise: 999
}

export function InviteForm({ tenantId, currentPlan, currentMemberCount }: InviteFormProps) {
  const [sending, setSending] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  
  const limit = PLAN_LIMITS[currentPlan as keyof typeof PLAN_LIMITS] || 1
  const canInvite = currentMemberCount < limit
  
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    
    if (!canInvite) {
      toast.error(`Your ${currentPlan} plan allows up to ${limit} team members. Please upgrade to add more.`)
      return
    }
    
    setSending(true)
    
    try {
      const formData = new FormData()
      formData.append('tenant_id', tenantId)
      formData.append('email', email)
      formData.append('role', role)
      
      const result = await inviteTeamMember(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`Invitation sent to ${email}`)
        setEmail('')
        setRole('viewer')
      }
    } catch (error) {
      toast.error('Failed to send invitation')
    } finally {
      setSending(false)
    }
  }
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-2">
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              className="input-field pl-10"
            />
          </div>
        </div>
        
        <div>
          <label htmlFor="role" className="block text-sm font-medium mb-2">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input-field"
          >
            <option value="viewer">Viewer - Can view campaigns and analytics</option>
            <option value="editor">Editor - Can create and edit campaigns</option>
            <option value="admin">Admin - Can manage team and settings</option>
          </select>
        </div>
      </div>
      
      {!canInvite && (
        <div className="p-3 bg-warning-light/10 border border-warning rounded-medium">
          <p className="text-sm text-warning">
            You've reached the team member limit for your {currentPlan} plan ({currentMemberCount}/{limit} members).
            <a href="/settings/billing" className="ml-1 underline">Upgrade your plan</a> to invite more team members.
          </p>
        </div>
      )}
      
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={sending || !canInvite}
          className="btn-primary flex items-center gap-2"
        >
          <Send className="w-4 h-4" />
          {sending ? 'Sending...' : 'Send Invitation'}
        </button>
      </div>
    </form>
  )
}