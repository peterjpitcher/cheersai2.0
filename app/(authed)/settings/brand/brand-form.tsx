'use client'

import { useState } from 'react'
import { updateBrand } from './actions'
import { toast } from 'sonner'
import type { Database } from '@/lib/types/database'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type BrandProfile = Database['public']['Tables']['brand_profiles']['Row']

interface BrandFormProps {
  brandProfile: BrandProfile | null
  tenantId: string
}

export function BrandForm({ brandProfile, tenantId }: BrandFormProps) {
  const brand: any = brandProfile as any
  const [saving, setSaving] = useState(false)

  // Controlled fields used for live preview
  const [brandVoice, setBrandVoice] = useState<string>(brand?.brand_voice || '')
  const [targetAudience, setTargetAudience] = useState<string>(brand?.target_audience || '')
  const [brandIdentity, setBrandIdentity] = useState<string>(brand?.brand_identity || '')
  const [primaryColor, setPrimaryColor] = useState<string>(brand?.primary_color || '#E74E2B')

  const [openingHours, setOpeningHours] = useState<any>(() => {
    const base = brand?.opening_hours && typeof brand.opening_hours === 'object' ? brand.opening_hours as any : {}
    const days = ['mon','tue','wed','thu','fri','sat','sun'] as const
    const defaults: any = {}
    for (const d of days) {
      const v = (base as any)[d] || {}
      defaults[d] = { closed: v.closed ?? false, open: v.open ?? '', close: v.close ?? '' }
    }
    defaults.exceptions = Array.isArray((base as any).exceptions) ? (base as any).exceptions : []
    return defaults
  })
  const [hoursOpen, setHoursOpen] = useState(false)

  // Serves food/drinks + menu URLs
  const [servesFood, setServesFood] = useState<boolean>(!!brand?.serves_food)
  const [servesDrinks, setServesDrinks] = useState<boolean>(brand?.serves_drinks ?? true)
  const [menuFoodUrl, setMenuFoodUrl] = useState<string>(brand?.menu_food_url || '')
  const [menuDrinkUrl, setMenuDrinkUrl] = useState<string>(brand?.menu_drink_url || '')

  async function handleSubmit(formData: FormData) {
    setSaving(true)
    try {
      formData.append('tenant_id', tenantId)
      formData.append('opening_hours', JSON.stringify(openingHours))
      // ensure controlled values are represented
      formData.set('brand_voice', brandVoice)
      formData.set('target_audience', targetAudience)
      formData.set('brand_identity', brandIdentity)
      formData.set('brand_color_hex', primaryColor)
      // Persist menu urls even when inputs are hidden/disabled
      formData.set('menu_food_url', menuFoodUrl)
      formData.set('menu_drink_url', menuDrinkUrl)
      const result = await updateBrand(formData)
      if (result.error) toast.error(result.error)
      else toast.success('Brand profile updated successfully')
    } catch {
      toast.error('Failed to update brand profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form action={handleSubmit} className="space-y-8">
      {/* Voice & Audience */}
      <div className="space-y-4">
          <div>
            <h3 className="font-heading text-lg font-bold">Voice & Audience</h3>
            <p className="mb-2 text-xs text-text-secondary">These shape how AI writes for you.</p>
            <Label htmlFor="brand_voice">Brand Voice & Tone</Label>
            <Textarea id="brand_voice" name="brand_voice" rows={4} value={brandVoice} onChange={(e)=>setBrandVoice(e.target.value)} maxLength={500} placeholder="Warm and welcoming, professional yet approachable, fun and energetic" />
            <p className="mt-1 text-xs text-text-secondary">How should your brand sound? ({brandVoice.length}/500)</p>
          </div>
          <div>
            <Label htmlFor="target_audience">Target Audience</Label>
            <Textarea id="target_audience" name="target_audience" rows={4} value={targetAudience} onChange={(e)=>setTargetAudience(e.target.value)} maxLength={500} placeholder="Local families, young professionals, tourists, craft beer enthusiasts" />
            <p className="mt-1 text-xs text-text-secondary">Who are you trying to reach? ({targetAudience.length}/500)</p>
          </div>
          <div>
            <Label htmlFor="brand_identity">Brand Identity & Values</Label>
            <Textarea id="brand_identity" name="brand_identity" rows={4} value={brandIdentity} onChange={(e)=>setBrandIdentity(e.target.value)} maxLength={500} placeholder="Family‑run since 1850, award‑winning Sunday roasts, live music venue" />
            <p className="mt-1 text-xs text-text-secondary">What makes your business special? ({brandIdentity.length}/500)</p>
          </div>
      </div>

      {/* Visual Identity */}
      <div>
        <h3 className="font-heading text-lg font-bold">Visual Identity</h3>
        <p className="mb-2 text-xs text-text-secondary">Set your primary brand colour.</p>
        <div className="flex items-center gap-4">
          <Input type="color" id="brand_color" name="brand_color" value={primaryColor} onChange={(e)=>setPrimaryColor(e.target.value)} className="h-12 w-24 cursor-pointer rounded-medium" />
          <Input name="brand_color_hex" value={primaryColor} onChange={(e)=>setPrimaryColor(e.target.value)} pattern="^#[0-9A-Fa-f]{6}$" className="w-32" placeholder="#RRGGBB" />
        </div>
      </div>

      {/* Business Details */}
      <div>
        <h3 className="font-heading text-lg font-bold">Business Details</h3>
        <p className="mb-2 text-xs text-text-secondary">Used in profile info and calls‑to‑action.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" placeholder="e.g. 0161 496 0000 or 07912 345678" defaultValue={brand?.phone || ''} />
            <p className="mt-1 text-xs text-text-secondary">Saved exactly as you type it</p>
          </div>
          <div>
            <Label htmlFor="website_url">Website</Label>
            <Input id="website_url" name="website_url" type="url" defaultValue={brand?.website_url || ''} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input id="whatsapp_enabled" name="whatsapp_enabled" type="checkbox" defaultChecked={!!brand?.whatsapp} />
              <Label htmlFor="whatsapp_enabled">We use WhatsApp/SMS</Label>
            </div>
            <Input id="whatsapp" name="whatsapp" placeholder="WhatsApp/SMS number" defaultValue={brand?.whatsapp || ''} className="mt-2" />
          </div>
          <div>
            <Label htmlFor="booking_url">Booking link</Label>
            <Input id="booking_url" name="booking_url" type="url" defaultValue={brand?.booking_url || ''} />
          </div>
          <div className="flex items-center gap-2">
            <input id="serves_food" name="serves_food" type="checkbox" checked={servesFood} onChange={(e)=>setServesFood(e.target.checked)} />
            <Label htmlFor="serves_food">Serves food</Label>
          </div>
          <div className="flex items-center gap-2">
            <input id="serves_drinks" name="serves_drinks" type="checkbox" checked={servesDrinks} onChange={(e)=>setServesDrinks(e.target.checked)} />
            <Label htmlFor="serves_drinks">Serves drinks</Label>
          </div>
        </div>
      </div>

      {/* Menus & Links */}
      <div>
        <h3 className="font-heading text-lg font-bold">Menus & Links</h3>
        <p className="mb-2 text-xs text-text-secondary">We suggest CTAs using these links.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Food menu */}
          <div>
            <input type="hidden" name="menu_food_url" value={menuFoodUrl} />
            <Label htmlFor="menu_food_url">Food menu URL</Label>
            {servesFood ? (
              <Input id="menu_food_url" type="url" value={menuFoodUrl} onChange={(e)=>setMenuFoodUrl(e.target.value)} placeholder="https://…" />
            ) : (
              <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm text-text-secondary">
                <span>{menuFoodUrl ? 'Link saved (not used when food is disabled)' : 'No link saved'}</span>
                {menuFoodUrl && (
                  <button type="button" className="text-xs text-error hover:underline" onClick={()=>setMenuFoodUrl('')}>Clear</button>
                )}
              </div>
            )}
          </div>
          {/* Drinks menu */}
          <div>
            <input type="hidden" name="menu_drink_url" value={menuDrinkUrl} />
            <Label htmlFor="menu_drink_url">Drinks menu URL</Label>
            {servesDrinks ? (
              <Input id="menu_drink_url" type="url" value={menuDrinkUrl} onChange={(e)=>setMenuDrinkUrl(e.target.value)} placeholder="https://…" />
            ) : (
              <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm text-text-secondary">
                <span>{menuDrinkUrl ? 'Link saved (not used when drinks are disabled)' : 'No link saved'}</span>
                {menuDrinkUrl && (
                  <button type="button" className="text-xs text-error hover:underline" onClick={()=>setMenuDrinkUrl('')}>Clear</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Opening Hours & Exceptions (collapsible) */}
      <div>
        <button type="button" onClick={() => setHoursOpen(o=>!o)} className="flex w-full items-center justify-between rounded-large border border-border bg-surface px-3 py-2 text-left">
          <span className="font-heading font-bold">Opening Hours & Exceptions</span>
          <span className="text-sm text-text-secondary">{hoursOpen ? 'Hide' : 'Show'}</span>
        </button>
        {hoursOpen && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-text-secondary">Times are saved as entered; posts format them for readability</p>
            <div className="grid gap-3 md:grid-cols-2">
              {(['mon','tue','wed','thu','fri','sat','sun'] as const).map((d) => (
                <div key={d} className="flex items-center justify-between gap-3 rounded-medium border border-border p-3">
                  <div className="w-20 text-sm font-medium uppercase">{d}</div>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={openingHours[d].closed} onChange={(e) => setOpeningHours((prev: any) => ({...prev, [d]: {...prev[d], closed: e.target.checked}}))} />
                    Closed
                  </label>
                  {!openingHours[d].closed && (
                    <div className="flex items-center gap-2">
                      <input type="time" className="rounded-md border border-input px-2 py-1 text-sm" value={openingHours[d].open}
                             onChange={(e) => setOpeningHours((prev: any) => ({...prev, [d]: {...prev[d], open: e.target.value}}))} />
                      <span className="text-xs text-text-secondary">to</span>
                      <input type="time" className="rounded-md border border-input px-2 py-1 text-sm" value={openingHours[d].close}
                             onChange={(e) => setOpeningHours((prev: any) => ({...prev, [d]: {...prev[d], close: e.target.value}}))} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium">Exceptions & Holidays</h4>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs">Date</label>
                  <input type="date" id="ex-date" className="rounded-md border border-input px-2 py-1 text-sm" />
                </div>
                <label className="mb-1 inline-flex items-center gap-2 text-sm"><input type="checkbox" id="ex-closed" /> Closed</label>
                <div>
                  <label className="mb-1 block text-xs">Open</label>
                  <input type="time" id="ex-open" className="rounded-md border border-input px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs">Close</label>
                  <input type="time" id="ex-close" className="rounded-md border border-input px-2 py-1 text-sm" />
                </div>
                <div className="min-w-[160px] flex-1">
                  <label className="mb-1 block text-xs">Note (optional)</label>
                  <input type="text" id="ex-note" className="w-full rounded-md border border-input px-2 py-1 text-sm" placeholder="e.g., Bank Holiday" />
                </div>
                <button type="button" className="rounded-md border px-3 py-2 text-sm"
                  onClick={() => {
                    const date = (document.getElementById('ex-date') as HTMLInputElement)?.value
                    const closed = (document.getElementById('ex-closed') as HTMLInputElement)?.checked
                    const open = (document.getElementById('ex-open') as HTMLInputElement)?.value
                    const close = (document.getElementById('ex-close') as HTMLInputElement)?.value
                    const note = (document.getElementById('ex-note') as HTMLInputElement)?.value
                    if (!date) return
                    setOpeningHours((prev: any) => ({...prev, exceptions: [...(prev.exceptions||[]), { date, closed, open, close, note }]}))
                  }}>Add</button>
              </div>
              {(openingHours.exceptions || []).length > 0 && (
                <div className="space-y-2">
                  {(openingHours.exceptions || []).map((ex: any, idx: number) => (
                    <div key={`ex-${idx}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <div className="text-text-secondary">{ex.date} {ex.closed ? '(Closed)' : `${ex.open || '—'}–${ex.close || '—'}`} {ex.note ? `• ${ex.note}` : ''}</div>
                      <button type="button" className="text-xs text-error hover:underline" onClick={() => setOpeningHours((prev: any) => ({...prev, exceptions: prev.exceptions.filter((_: any, i: number) => i !== idx)}))}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>Save Brand Profile</Button>
      </div>
    </form>
  )
}
