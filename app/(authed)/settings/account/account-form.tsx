'use client'

import { useState } from 'react'
import { updateAccount } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'

type User = Database['public']['Tables']['users']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

interface AccountFormProps {
  user: User
  tenant: Tenant
}

export function AccountForm({ user, tenant }: AccountFormProps) {
  const [saving, setSaving] = useState(false)
  
  async function handleSubmit(formData: FormData) {
    setSaving(true)
    
    try {
      const result = await updateAccount(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Account information updated successfully')
      }
    } catch (error) {
      toast.error('Failed to update account information')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <form action={handleSubmit} className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="first_name" className="block text-sm font-medium mb-2">
            First Name
          </label>
          <input
            type="text"
            id="first_name"
            name="first_name"
            defaultValue={user.first_name || ''}
            className="input-field"
            required
          />
        </div>
        
        <div>
          <label htmlFor="last_name" className="block text-sm font-medium mb-2">
            Last Name
          </label>
          <input
            type="text"
            id="last_name"
            name="last_name"
            defaultValue={user.last_name || ''}
            className="input-field"
            required
          />
        </div>
      </div>
      
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-2">
          Email Address
        </label>
        <input
          type="email"
          id="email"
          name="email"
          defaultValue={user.email}
          className="input-field bg-gray-50"
          disabled
        />
        <p className="text-xs text-text-secondary mt-1">
          Email address cannot be changed
        </p>
      </div>
      
      <div>
        <label htmlFor="tenant_name" className="block text-sm font-medium mb-2">
          Business Name
        </label>
        <input
          type="text"
          id="tenant_name"
          name="tenant_name"
          defaultValue={tenant.name}
          className="input-field"
          required
        />
      </div>
      
      <div>
        <label htmlFor="business_type" className="block text-sm font-medium mb-2">
          Business Type
        </label>
        <select
          id="business_type"
          name="business_type"
          defaultValue={tenant.business_type || 'pub'}
          className="input-field"
        >
          <option value="pub">Traditional Pub</option>
          <option value="bar">Modern Bar</option>
          <option value="restaurant">Restaurant</option>
          <option value="hotel">Hotel Bar</option>
          <option value="cafe">Cafe</option>
          <option value="other">Other</option>
        </select>
      </div>
      
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}