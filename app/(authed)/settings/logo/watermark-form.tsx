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
          <div className="relative rounded-medium overflow-hidden h-64">
            {/* Hospitality-style background image */}
            <div 
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `linear-gradient(rgba(0,0,0,0.1), rgba(0,0,0,0.2)), url('data:image/svg+xml;base64,${btoa(`
                  <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
                    <!-- Wood table background -->
                    <rect fill="#8B4513" width="400" height="300"/>
                    <rect fill="#A0522D" width="400" height="2" y="30" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="60" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="90" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="120" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="150" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="180" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="210" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="240" opacity="0.3"/>
                    <rect fill="#A0522D" width="400" height="2" y="270" opacity="0.3"/>
                    
                    <!-- Plate -->
                    <ellipse cx="200" cy="150" rx="120" ry="100" fill="white" opacity="0.95"/>
                    <ellipse cx="200" cy="150" rx="110" ry="90" fill="none" stroke="#ddd" stroke-width="1"/>
                    
                    <!-- Food items suggesting a gourmet burger -->
                    <ellipse cx="200" cy="160" rx="65" ry="20" fill="#8B4513" opacity="0.8"/> <!-- Bottom bun -->
                    <rect x="170" y="145" width="60" height="8" rx="2" fill="#654321" opacity="0.9"/> <!-- Patty -->
                    <path d="M165 143 Q200 135 235 143" fill="#90EE90" opacity="0.7"/> <!-- Lettuce -->
                    <rect x="175" y="138" width="50" height="3" fill="#FFD700" opacity="0.8"/> <!-- Cheese -->
                    <ellipse cx="200" cy="130" rx="65" ry="25" fill="#8B4513" opacity="0.8"/> <!-- Top bun -->
                    <circle cx="185" cy="125" r="2" fill="#F5DEB3" opacity="0.6"/> <!-- Sesame seed -->
                    <circle cx="200" cy="123" r="2" fill="#F5DEB3" opacity="0.6"/> <!-- Sesame seed -->
                    <circle cx="215" cy="125" r="2" fill="#F5DEB3" opacity="0.6"/> <!-- Sesame seed -->
                    
                    <!-- Chips/fries on the side -->
                    <rect x="250" y="150" width="3" height="25" fill="#FFD700" opacity="0.7" transform="rotate(10 251 162)"/>
                    <rect x="255" y="152" width="3" height="25" fill="#FFD700" opacity="0.7" transform="rotate(15 256 164)"/>
                    <rect x="260" y="148" width="3" height="25" fill="#FFD700" opacity="0.7" transform="rotate(5 261 160)"/>
                    
                    <!-- Glass suggestion -->
                    <rect x="80" y="100" width="40" height="60" rx="2" fill="rgba(135,206,235,0.3)"/>
                    <rect x="80" y="100" width="40" height="50" fill="rgba(255,215,0,0.2)"/> <!-- Beer -->
                    <ellipse cx="100" cy="150" rx="20" ry="5" fill="rgba(135,206,235,0.2)"/>
                    
                    <!-- Text overlay suggesting menu special -->
                    <text x="200" y="40" text-anchor="middle" fill="white" font-family="Arial" font-size="18" font-weight="bold" opacity="0.9">Today's Special</text>
                    <text x="200" y="260" text-anchor="middle" fill="white" font-family="Arial" font-size="14" opacity="0.8">Gourmet Burger & Chips</text>
                  </svg>
                `)}')`
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            </div>
            
            {/* Watermark logo overlay */}
            <div 
              className="absolute p-2"
              style={{
                opacity: watermarkSettings?.opacity || 0.8,
                width: `${watermarkSettings?.size_percent || 15}%`,
                ...(watermarkSettings?.position === 'top-left' && { top: watermarkSettings?.margin_pixels || 20, left: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'top-center' && { top: watermarkSettings?.margin_pixels || 20, left: '50%', transform: 'translateX(-50%)' }),
                ...(watermarkSettings?.position === 'top-right' && { top: watermarkSettings?.margin_pixels || 20, right: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'center-left' && { top: '50%', left: watermarkSettings?.margin_pixels || 20, transform: 'translateY(-50%)' }),
                ...(watermarkSettings?.position === 'center' && { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
                ...(watermarkSettings?.position === 'center-right' && { top: '50%', right: watermarkSettings?.margin_pixels || 20, transform: 'translateY(-50%)' }),
                ...(watermarkSettings?.position === 'bottom-left' && { bottom: watermarkSettings?.margin_pixels || 20, left: watermarkSettings?.margin_pixels || 20 }),
                ...(watermarkSettings?.position === 'bottom-center' && { bottom: watermarkSettings?.margin_pixels || 20, left: '50%', transform: 'translateX(-50%)' }),
                ...(watermarkSettings?.position === 'bottom-right' && { bottom: watermarkSettings?.margin_pixels || 20, right: watermarkSettings?.margin_pixels || 20 }),
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