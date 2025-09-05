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
  
  // State for live preview updates
  const [enabled, setEnabled] = useState(watermarkSettings?.enabled ?? false)
  const [autoApply, setAutoApply] = useState(watermarkSettings?.auto_apply ?? false)
  const [position, setPosition] = useState(watermarkSettings?.position || 'bottom-right')
  const [opacity, setOpacity] = useState(watermarkSettings?.opacity || 0.8)
  const [sizePercent, setSizePercent] = useState(watermarkSettings?.size_percent || 15)
  const [marginPixels, setMarginPixels] = useState(watermarkSettings?.margin_pixels || 20)
  
  async function handleSubmit(formData: FormData) {
    if (!activeLogo) {
      toast.error('Please upload and set an active logo first')
      return
    }
    
    setSaving(true)
    
    try {
      formData.append('tenant_id', tenantId)
      
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
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
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
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
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
          value={position}
          onChange={(e) => setPosition(e.target.value)}
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
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm text-text-secondary w-10">
              {(opacity * 100).toFixed(0)}%
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
              value={sizePercent}
              onChange={(e) => setSizePercent(parseInt(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm text-text-secondary w-10">
              {sizePercent}%
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
            value={marginPixels}
            onChange={(e) => setMarginPixels(parseInt(e.target.value) || 0)}
            className="input-field"
          />
        </div>
      </div>
      
      {activeLogo && (
        <div>
          <label className="block text-sm font-medium mb-2">Preview</label>
          <div className="relative rounded-medium overflow-hidden aspect-square bg-gray-100 max-w-xs mx-auto md:mx-0">
            {/* Hospitality-style background image using Unsplash - square format */}
            <img 
              src="https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&h=600&fit=crop"
              alt="Restaurant food"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            
            {/* Watermark logo overlay */}
            <div 
              className="absolute p-2"
              style={{
                opacity: opacity,
                width: `${sizePercent}%`,
                ...(position === 'top-left' && { top: marginPixels, left: marginPixels }),
                ...(position === 'top-center' && { top: marginPixels, left: '50%', transform: 'translateX(-50%)' }),
                ...(position === 'top-right' && { top: marginPixels, right: marginPixels }),
                ...(position === 'center-left' && { top: '50%', left: marginPixels, transform: 'translateY(-50%)' }),
                ...(position === 'center' && { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
                ...(position === 'center-right' && { top: '50%', right: marginPixels, transform: 'translateY(-50%)' }),
                ...(position === 'bottom-left' && { bottom: marginPixels, left: marginPixels }),
                ...(position === 'bottom-center' && { bottom: marginPixels, left: '50%', transform: 'translateX(-50%)' }),
                ...(position === 'bottom-right' && { bottom: marginPixels, right: marginPixels }),
              }}
            >
              <img
                src={activeLogo.file_url}
                alt="Watermark preview"
                className="w-full h-full object-contain drop-shadow-lg"
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