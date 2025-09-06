'use client'

import { useState } from 'react'
import { updateBrand } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'

type BrandProfile = Database['public']['Tables']['brand_profiles']['Row']

interface BrandFormProps {
  brandProfile: BrandProfile | null
  tenantId: string
}

export function BrandForm({ brandProfile, tenantId }: BrandFormProps) {
  const [saving, setSaving] = useState(false)
  
  async function handleSubmit(formData: FormData) {
    setSaving(true)
    
    try {
      formData.append('tenant_id', tenantId)
      const result = await updateBrand(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Brand profile updated successfully')
      }
    } catch (error) {
      toast.error('Failed to update brand profile')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <form action={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="brand_voice" className="block text-sm font-medium mb-2">
          Brand Voice & Tone
        </label>
        <textarea
          id="brand_voice"
          name="brand_voice"
          rows={4}
          defaultValue={brandProfile?.brand_voice || ''}
          placeholder="Describe how your brand communicates (e.g., Warm and welcoming, professional yet approachable, fun and energetic)"
          className="input-field"
          maxLength={500}
        />
        <p className="text-xs text-text-secondary mt-1">
          How should your brand sound in social media posts?
        </p>
      </div>
      
      <div>
        <label htmlFor="target_audience" className="block text-sm font-medium mb-2">
          Target Audience
        </label>
        <textarea
          id="target_audience"
          name="target_audience"
          rows={4}
          defaultValue={brandProfile?.target_audience || ''}
          placeholder="Describe your ideal customers (e.g., Local families, young professionals, tourists, craft beer enthusiasts)"
          className="input-field"
          maxLength={500}
        />
        <p className="text-xs text-text-secondary mt-1">
          Who are you trying to reach with your content?
        </p>
      </div>
      
      <div>
        <label htmlFor="brand_identity" className="block text-sm font-medium mb-2">
          Brand Identity & Values
        </label>
        <textarea
          id="brand_identity"
          name="brand_identity"
          rows={4}
          defaultValue={brandProfile?.brand_identity || ''}
          placeholder="What makes your business unique? (e.g., Family-run since 1850, award-winning Sunday roasts, live music venue)"
          className="input-field"
          maxLength={500}
        />
        <p className="text-xs text-text-secondary mt-1">
          What makes your business special and unique?
        </p>
      </div>
      
      <div>
        <label htmlFor="brand_color" className="block text-sm font-medium mb-2">
          Brand Colour
        </label>
        <div className="flex items-center gap-4">
          <input
            type="color"
            id="brand_color"
            name="brand_color"
            defaultValue={brandProfile?.primary_color || '#EA580C'}
            className="h-12 w-24 rounded-medium border border-border cursor-pointer"
          />
          <input
            type="text"
            name="brand_color_hex"
            defaultValue={brandProfile?.primary_color || '#EA580C'}
            pattern="^#[0-9A-Fa-f]{6}$"
            className="input-field w-32"
            placeholder="#EA580C"
          />
        </div>
        <p className="text-xs text-text-secondary mt-1">
          Your primary brand colour for visual consistency
        </p>
      </div>
      
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary"
        >
          {saving ? 'Saving...' : 'Save Brand Profile'}
        </button>
      </div>
    </form>
  )
}
