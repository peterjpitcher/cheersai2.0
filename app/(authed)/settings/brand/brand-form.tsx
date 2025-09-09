'use client'

import { useState } from 'react'
import { updateBrand } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatUkPhoneDisplay } from '@/lib/utils/format'

type BrandProfile = Database['public']['Tables']['brand_profiles']['Row']

interface BrandFormProps {
  brandProfile: BrandProfile | null
  tenantId: string
}

export function BrandForm({ brandProfile, tenantId }: BrandFormProps) {
  const brand: any = brandProfile as any
  const [saving, setSaving] = useState(false)
  const [openingHours, setOpeningHours] = useState<any>(() => {
    const base = brand?.opening_hours && typeof brand.opening_hours === 'object' ? brand.opening_hours as any : {}
    const days = ['mon','tue','wed','thu','fri','sat','sun'] as const
    const defaults: any = {}
    for (const d of days) {
      const v = (base as any)[d] || {}
      defaults[d] = {
        closed: v.closed ?? false,
        open: v.open ?? '',
        close: v.close ?? ''
      }
    }
    // exceptions: [{ date: 'YYYY-MM-DD', closed: boolean, open?: 'HH:MM', close?: 'HH:MM' }]
    defaults.exceptions = Array.isArray((base as any).exceptions) ? (base as any).exceptions : []
    return defaults
  })
  
  async function handleSubmit(formData: FormData) {
    setSaving(true)
    
    try {
      formData.append('tenant_id', tenantId)
      formData.append('opening_hours', JSON.stringify(openingHours))
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
      {/* Opening Hours */}
      <div>
        <h3 className="text-lg font-heading font-bold">Opening Hours</h3>
        <p className="text-xs text-text-secondary mb-2">Times are saved as entered; posts format them for readability</p>
        <div className="grid md:grid-cols-2 gap-3">
          {(['mon','tue','wed','thu','fri','sat','sun'] as const).map((d) => (
            <div key={d} className="border border-border rounded-medium p-3 flex items-center justify-between gap-3">
              <div className="w-20 text-sm font-medium uppercase">{d}</div>
              <label className="text-xs inline-flex items-center gap-2">
                <input type="checkbox" checked={openingHours[d].closed} onChange={(e) => setOpeningHours((prev: any) => ({...prev, [d]: {...prev[d], closed: e.target.checked}}))} />
                Closed
              </label>
              {!openingHours[d].closed && (
                <div className="flex items-center gap-2">
                  <input type="time" className="border border-input rounded-md px-2 py-1 text-sm" value={openingHours[d].open}
                         onChange={(e) => setOpeningHours((prev: any) => ({...prev, [d]: {...prev[d], open: e.target.value}}))} />
                  <span className="text-xs text-text-secondary">to</span>
                  <input type="time" className="border border-input rounded-md px-2 py-1 text-sm" value={openingHours[d].close}
                         onChange={(e) => setOpeningHours((prev: any) => ({...prev, [d]: {...prev[d], close: e.target.value}}))} />
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Exceptions / Holidays */}
        <div className="mt-4">
          <h4 className="text-sm font-medium mb-2">Exceptions & Holidays</h4>
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <div>
                <label className="block text-xs mb-1">Date</label>
                <input type="date" id="ex-date" className="border border-input rounded-md px-2 py-1 text-sm" />
              </div>
              <label className="inline-flex items-center gap-2 text-sm mb-1">
                <input type="checkbox" id="ex-closed" /> Closed
              </label>
              <div>
                <label className="block text-xs mb-1">Open</label>
                <input type="time" id="ex-open" className="border border-input rounded-md px-2 py-1 text-sm" />
              </div>
              <div>
                <label className="block text-xs mb-1">Close</label>
                <input type="time" id="ex-close" className="border border-input rounded-md px-2 py-1 text-sm" />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs mb-1">Note (optional)</label>
                <input type="text" id="ex-note" className="w-full border border-input rounded-md px-2 py-1 text-sm" placeholder="e.g., Bank Holiday" />
              </div>
              <button
                type="button"
                className="px-3 py-2 text-sm border border-input rounded-md"
                onClick={() => {
                  const dateEl = document.getElementById('ex-date') as HTMLInputElement
                  const closedEl = document.getElementById('ex-closed') as HTMLInputElement
                  const openEl = document.getElementById('ex-open') as HTMLInputElement
                  const closeEl = document.getElementById('ex-close') as HTMLInputElement
                  const noteEl = document.getElementById('ex-note') as HTMLInputElement
                  const date = dateEl?.value
                  if (!date) return
                  const entry: any = { date, closed: !!closedEl?.checked }
                  if (!entry.closed) {
                    if (!openEl?.value || !closeEl?.value) return
                    entry.open = openEl.value
                    entry.close = closeEl.value
                  }
                  if (noteEl?.value) entry.note = noteEl.value
                  setOpeningHours((prev: any) => ({
                    ...prev,
                    exceptions: [...(prev.exceptions || []), entry]
                  }))
                  if (dateEl) dateEl.value = ''
                  if (closedEl) closedEl.checked = false
                  if (openEl) openEl.value = ''
                  if (closeEl) closeEl.value = ''
                  if (noteEl) noteEl.value = ''
                }}
              >
                Add Exception
              </button>
            </div>

          {(openingHours.exceptions || []).length === 0 ? (
            <p className="text-xs text-text-secondary">No exceptions added</p>
          ) : (
            <div className="divide-y border rounded-medium">
              {(openingHours.exceptions || []).map((ex: any, idx: number) => (
                <div key={`${ex.date}-${idx}`} className="flex items-start justify-between p-2 text-sm gap-3">
                  <div className="flex-1">
                    <div>
                      <span className="font-medium mr-2">{ex.date}</span>
                      {ex.closed ? (
                        <span className="text-text-secondary">Closed</span>
                      ) : (
                        <span className="text-text-secondary">{ex.open}–{ex.close}</span>
                      )}
                    </div>
                    {ex.note && (
                      <div className="text-xs text-text-secondary mt-0.5">{ex.note}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-error hover:underline"
                    onClick={() => setOpeningHours((prev: any) => ({
                      ...prev,
                      exceptions: prev.exceptions.filter((_: any, i: number) => i !== idx)
                    }))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            placeholder="e.g. 0161 496 0000 or 07912 345678"
            defaultValue={brand?.phone_e164 ? formatUkPhoneDisplay(brand.phone_e164) : ''}
          />
          <p className="text-xs text-text-secondary mt-1">Displayed without +44</p>
        </div>
        <div>
          <Label htmlFor="website_url">Website</Label>
          <Input id="website_url" name="website_url" type="url" defaultValue={brand?.website_url || ''} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <input id="whatsapp_enabled" name="whatsapp_enabled" type="checkbox" defaultChecked={!!brand?.whatsapp_e164} />
            <Label htmlFor="whatsapp_enabled">We use WhatsApp/SMS</Label>
          </div>
          <Input
            id="whatsapp"
            name="whatsapp"
            placeholder="WhatsApp/SMS number"
            defaultValue={brand?.whatsapp_e164 ? formatUkPhoneDisplay(brand.whatsapp_e164) : ''}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="booking_url">Booking link</Label>
          <Input id="booking_url" name="booking_url" type="url" defaultValue={brand?.booking_url || ''} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <input id="serves_food" name="serves_food" type="checkbox" defaultChecked={!!brand?.serves_food} />
            <Label htmlFor="serves_food">Serves food</Label>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <input id="serves_drinks" name="serves_drinks" type="checkbox" defaultChecked={brand?.serves_drinks ?? true} />
            <Label htmlFor="serves_drinks">Serves drinks</Label>
          </div>
        </div>
        <div>
          <Label htmlFor="menu_food_url">Food menu URL</Label>
          <Input id="menu_food_url" name="menu_food_url" type="url" defaultValue={brand?.menu_food_url || ''} />
        </div>
        <div>
          <Label htmlFor="menu_drink_url">Drinks menu URL</Label>
          <Input id="menu_drink_url" name="menu_drink_url" type="url" defaultValue={brand?.menu_drink_url || ''} />
        </div>
      </div>

      <div>
        <Label htmlFor="brand_voice">Brand Voice & Tone</Label>
        <Textarea
          id="brand_voice"
          name="brand_voice"
          rows={4}
          defaultValue={brand?.brand_voice || ''}
          placeholder="Describe how your brand communicates (e.g., Warm and welcoming, professional yet approachable, fun and energetic)"
          maxLength={500}
        />
        <p className="text-xs text-text-secondary mt-1">
          How should your brand sound in social media posts?
        </p>
      </div>
      
      <div>
        <Label htmlFor="target_audience">Target Audience</Label>
        <Textarea
          id="target_audience"
          name="target_audience"
          rows={4}
          defaultValue={brand?.target_audience || ''}
          placeholder="Describe your ideal customers (e.g., Local families, young professionals, tourists, craft beer enthusiasts)"
          maxLength={500}
        />
        <p className="text-xs text-text-secondary mt-1">
          Who are you trying to reach with your content?
        </p>
      </div>
      
      <div>
        <Label htmlFor="brand_identity">Brand Identity & Values</Label>
        <Textarea
          id="brand_identity"
          name="brand_identity"
          rows={4}
          defaultValue={brand?.brand_identity || ''}
          placeholder="What makes your business unique? (e.g., Family-run since 1850, award-winning Sunday roasts, live music venue)"
          maxLength={500}
        />
        <p className="text-xs text-text-secondary mt-1">
          What makes your business special and unique?
        </p>
      </div>
      
      <div>
        <Label htmlFor="brand_color">Brand Colour</Label>
        <div className="flex items-center gap-4">
          <Input
            type="color"
            id="brand_color"
            name="brand_color"
            defaultValue={brand?.primary_color || undefined}
            className="h-12 w-24 rounded-medium cursor-pointer"
          />
          <Input
            name="brand_color_hex"
            defaultValue={brand?.primary_color || ''}
            pattern="^#[0-9A-Fa-f]{6}$"
            className="w-32"
            placeholder="#RRGGBB"
          />
        </div>
        <p className="text-xs text-text-secondary mt-1">
          Your primary brand colour for visual consistency
        </p>
      </div>
      
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save Brand Profile
        </Button>
      </div>
    </form>
  )
}
