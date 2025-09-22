'use client'

import { useState, useId } from 'react'
import { updateWatermarkSettings } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import NextImage from 'next/image'

type WatermarkSettings = Database['public']['Tables']['watermark_settings']['Row']
type Logo = Database['public']['Tables']['tenant_logos']['Row']

interface WatermarkFormProps {
  watermarkSettings: WatermarkSettings | null
  logos: Logo[]
  tenantId: string
}

const POSITIONS = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Centre' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'center-left', label: 'Centre Left' },
  { value: 'center', label: 'Centre' },
  { value: 'center-right', label: 'Centre Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Centre' },
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
  const enableId = useId()
  const autoApplyId = useId()
  
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
    } catch {
      toast.error('Failed to save watermark settings')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <form action={handleSubmit} className="space-y-6">
      {!activeLogo && (
        <div className="rounded-medium border border-warning bg-warning/10 p-4">
          <p className="text-sm text-warning">
            Please upload and set an active logo before configuring watermark settings.
          </p>
        </div>
      )}
      
      <div>
        <div className="flex items-center gap-2">
          <input
            id={enableId}
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Label htmlFor={enableId} className="text-sm font-medium">
            Enable watermark on images
          </Label>
        </div>
        <p className="ml-6 mt-1 text-xs text-text-secondary">
          When enabled, your logo will be added to images in campaigns
        </p>
      </div>
      
      <div>
        <div className="flex items-center gap-2">
          <input
            id={autoApplyId}
            type="checkbox"
            name="auto_apply"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
            className="rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Label htmlFor={autoApplyId} className="text-sm font-medium">
            Auto-apply to new images
          </Label>
        </div>
        <p className="ml-6 mt-1 text-xs text-text-secondary">
          Automatically add watermark when uploading new images
        </p>
      </div>
      
      <div>
        <Label htmlFor="position">Watermark Position</Label>
        <Select
          id="position"
          name="position"
          value={position}
          onChange={(e) => setPosition((e.target as HTMLSelectElement).value)}
        >
          {POSITIONS.map(pos => (
            <option key={pos.value} value={pos.value}>
              {pos.label}
            </option>
          ))}
        </Select>
      </div>
      
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="opacity">Opacity</Label>
          <div className="flex items-center gap-2">
            <Input
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
            <span className="w-10 text-sm text-text-secondary">
              {(opacity * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        
        <div>
          <Label htmlFor="size_percent">Size (% of image)</Label>
          <div className="flex items-center gap-2">
            <Input
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
            <span className="w-10 text-sm text-text-secondary">
              {sizePercent}%
            </span>
          </div>
        </div>
        
        <div>
          <Label htmlFor="margin_pixels">Margin (pixels)</Label>
          <Input
            type="number"
            id="margin_pixels"
            name="margin_pixels"
            min="0"
            max="100"
            value={marginPixels}
            onChange={(e) => setMarginPixels(parseInt(e.target.value) || 0)}
            className="w-full"
          />
        </div>
      </div>
      
      {activeLogo && (
        <div>
          <p className="mb-2 block text-sm font-medium">Preview</p>
          <div className="relative mx-auto aspect-square max-w-xs overflow-hidden rounded-medium bg-gray-100 md:mx-0">
            {/* Hospitality-style background image using Unsplash - square format */}
            <NextImage
              src="https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&h=600&fit=crop"
              alt="Restaurant food"
              fill
              sizes="300px"
              className="object-cover"
              priority
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
              <NextImage
                src={activeLogo.file_url}
                alt="Watermark preview"
                width={300}
                height={300}
                className="h-auto w-full object-contain drop-shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
      
      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={!activeLogo}>
          Save Watermark Settings
        </Button>
      </div>
    </form>
  )
}
