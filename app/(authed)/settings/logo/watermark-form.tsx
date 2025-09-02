'use client'

import { useState } from 'react'
import { updateWatermarkSettings } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'

type WatermarkSettings = Database['public']['Tables']['watermark_settings']['Row']
type Logo = Database['public']['Tables']['tenant_logos']['Row']

interface WatermarkFormProps {
  watermarkSettings: WatermarkSettings | null
  logos: Logo[]
  tenantId: string
}

const POSITIONS = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'center-left', label: 'Center Left' },
  { value: 'center', label: 'Center' },
  { value: 'center-right', label: 'Center Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' },
]

export function WatermarkForm({ watermarkSettings, logos, tenantId }: WatermarkFormProps) {
  const [saving, setSaving] = useState(false)
  const activeLogo = logos.find(l => l.is_active)
  
  async function handleSubmit(formData: FormData) {
    if (!activeLogo) {
      toast.error('Please upload and set an active logo first')
      return
    }
    
    setSaving(true)
    
    try {
      formData.append('tenant_id', tenantId)
      formData.append('active_logo_id', activeLogo.id)
      
      const result = await updateWatermarkSettings(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Watermark settings saved successfully')
      }
    } catch (error) {
      toast.error('Failed to save watermark settings')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <form action={handleSubmit} className="space-y-6">
      {!activeLogo && (
        <div className="p-4 bg-warning-light/10 border border-warning rounded-medium">
          <p className="text-sm text-warning">
            Please upload and set an active logo before configuring watermark settings.
          </p>
        </div>
      )}
      
      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={watermarkSettings?.enabled ?? false}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium">Enable watermark on images</span>
        </label>
        <p className="text-xs text-text-secondary mt-1 ml-6">
          When enabled, your logo will be added to images in campaigns
        </p>
      </div>
      
      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="auto_apply"
            defaultChecked={watermarkSettings?.auto_apply ?? false}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium">Auto-apply to new images</span>
        </label>
        <p className="text-xs text-text-secondary mt-1 ml-6">
          Automatically add watermark when uploading new images
        </p>
      </div>
      
      <div>
        <label htmlFor="position" className="block text-sm font-medium mb-2">
          Watermark Position
        </label>
        <select
          id="position"
          name="position"
          defaultValue={watermarkSettings?.position || 'bottom-right'}
          className="input-field"
        >
          {POSITIONS.map(pos => (
            <option key={pos.value} value={pos.value}>
              {pos.label}
            </option>
          ))}
        </select>
      </div>
      
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="opacity" className="block text-sm font-medium mb-2">
            Opacity
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              id="opacity"
              name="opacity"
              min="0.1"
              max="1"
              step="0.1"
              defaultValue={watermarkSettings?.opacity || 0.8}
              className="flex-1"
            />
            <span className="text-sm text-text-secondary w-10">
              {((watermarkSettings?.opacity || 0.8) * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        
        <div>
          <label htmlFor="size_percent" className="block text-sm font-medium mb-2">
            Size (% of image)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              id="size_percent"
              name="size_percent"
              min="5"
              max="30"
              step="1"
              defaultValue={watermarkSettings?.size_percent || 15}
              className="flex-1"
            />
            <span className="text-sm text-text-secondary w-10">
              {watermarkSettings?.size_percent || 15}%
            </span>
          </div>
        </div>
        
        <div>
          <label htmlFor="margin_pixels" className="block text-sm font-medium mb-2">
            Margin (pixels)
          </label>
          <input
            type="number"
            id="margin_pixels"
            name="margin_pixels"
            min="0"
            max="100"
            defaultValue={watermarkSettings?.margin_pixels || 20}
            className="input-field"
          />
        </div>
      </div>
      
      {activeLogo && (
        <div>
          <label className="block text-sm font-medium mb-2">Preview</label>
          <div className="relative bg-gray-100 rounded-medium p-4 h-48 flex items-center justify-center">
            <p className="text-text-secondary text-sm">
              Watermark preview will appear on your images
            </p>
            <div 
              className="absolute p-2"
              style={{
                opacity: watermarkSettings?.opacity || 0.8,
                width: `${watermarkSettings?.size_percent || 15}%`,
                ...(watermarkSettings?.position === 'top-left' && { top: watermarkSettings?.margin_pixels || 20, left: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'top-right' && { top: watermarkSettings?.margin_pixels || 20, right: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'bottom-left' && { bottom: watermarkSettings?.margin_pixels || 20, left: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'bottom-right' && { bottom: watermarkSettings?.margin_pixels || 20, right: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'center' && { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
              }}
            >
              <img
                src={activeLogo.file_url}
                alt="Watermark preview"
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
      
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || !activeLogo}
          className="btn-primary"
        >
          {saving ? 'Saving...' : 'Save Watermark Settings'}
        </button>
      </div>
    </form>
  )
}