'use client'

import { useState } from 'react'
import { updatePassword } from './actions'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'

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
        <label htmlFor="current_password" className="block text-sm font-medium mb-2">
          Current Password
        </label>
        <div className="relative">
          <input
            type={showCurrent ? 'text' : 'password'}
            id="current_password"
            name="current_password"
            className="input-field pr-10"
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
        <label htmlFor="new_password" className="block text-sm font-medium mb-2">
          New Password
        </label>
        <div className="relative">
          <input
            type={showNew ? 'text' : 'password'}
            id="new_password"
            name="new_password"
            className="input-field pr-10"
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
        <label htmlFor="confirm_password" className="block text-sm font-medium mb-2">
          Confirm New Password
        </label>
        <div className="relative">
          <input
            type={showConfirm ? 'text' : 'password'}
            id="confirm_password"
            name="confirm_password"
            className="input-field pr-10"
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
        <button
          type="submit"
          disabled={saving}
          className="btn-primary"
        >
          {saving ? 'Updating...' : 'Update Password'}
        </button>
      </div>
    </form>
  )
}