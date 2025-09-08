'use client'

import { useState } from 'react'
import { updatePassword } from './actions'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function PasswordForm() {
  const [saving, setSaving] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  
  async function handleSubmit(formData: FormData) {
    setSaving(true)
    
    // Client-side validation
    const newPassword = formData.get('new_password') as string
    const confirmPassword = formData.get('confirm_password') as string
    
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      setSaving(false)
      return
    }
    
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long')
      setSaving(false)
      return
    }
    
    try {
      const result = await updatePassword(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Password updated successfully')
        // Clear the form
        const form = document.getElementById('password-form') as HTMLFormElement
        form?.reset()
      }
    } catch (error) {
      toast.error('Failed to update password')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <form id="password-form" action={handleSubmit} className="space-y-6">
      <div>
        <Label htmlFor="current_password">Current Password</Label>
        <div className="relative">
          <Input
            type={showCurrent ? 'text' : 'password'}
            id="current_password"
            name="current_password"
            className="pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setShowCurrent(!showCurrent)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
          >
            {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      
      <div>
        <Label htmlFor="new_password">New Password</Label>
        <div className="relative">
          <Input
            type={showNew ? 'text' : 'password'}
            id="new_password"
            name="new_password"
            className="pr-10"
            required
            minLength={8}
          />
          <button
            type="button"
            onClick={() => setShowNew(!showNew)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
          >
            {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      
      <div>
        <Label htmlFor="confirm_password">Confirm New Password</Label>
        <div className="relative">
          <Input
            type={showConfirm ? 'text' : 'password'}
            id="confirm_password"
            name="confirm_password"
            className="pr-10"
            required
            minLength={8}
          />
          <button
            type="button"
            onClick={() => setShowConfirm(!showConfirm)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
          >
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Update Password
        </Button>
      </div>
    </form>
  )
}
