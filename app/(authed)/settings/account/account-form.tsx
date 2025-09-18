'use client'

import { useState } from 'react'
import { updateAccount } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

type User = Database['public']['Tables']['users']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

interface AccountFormProps {
  user: User
  tenant: Tenant
  weekStart?: 'sunday'|'monday'
}

export function AccountForm({ user, tenant, weekStart = 'monday' }: AccountFormProps) {
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
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <Label htmlFor="first_name">First Name</Label>
          <Input
            id="first_name"
            name="first_name"
            defaultValue={user.first_name || ''}
            required
          />
        </div>
        
        <div>
          <Label htmlFor="last_name">Last Name</Label>
          <Input
            id="last_name"
            name="last_name"
            defaultValue={user.last_name || ''}
            required
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="email">Email Address</Label>
        <Input
          type="email"
          id="email"
          name="email"
          defaultValue={user.email || ''}
          className="bg-gray-50"
          disabled
        />
        <p className="mt-1 text-xs text-text-secondary">
          Email address cannot be changed
        </p>
      </div>
      
      <div>
        <Label htmlFor="tenant_name">Business Name</Label>
        <Input
          id="tenant_name"
          name="tenant_name"
          defaultValue={tenant.name || ''}
          required
        />
      </div>
      
      <div>
        <Label htmlFor="business_type">Business Type</Label>
        <Select
          id="business_type"
          name="business_type"
          defaultValue={(tenant as any).business_type || 'pub'}
        >
          <option value="pub">Traditional Pub</option>
          <option value="bar">Modern Bar</option>
          <option value="restaurant">Restaurant</option>
          <option value="hotel">Hotel Bar</option>
          <option value="cafe">Cafe</option>
          <option value="other">Other</option>
        </Select>
      </div>

      <div>
        <Label htmlFor="week_start">Week starts on</Label>
        <Select id="week_start" name="week_start" defaultValue={weekStart}>
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </Select>
        <p className="mt-1 text-xs text-text-secondary">Controls how weeks are displayed in calendars and timelines.</p>
      </div>
      
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save Changes
        </Button>
      </div>
    </form>
  )
}
