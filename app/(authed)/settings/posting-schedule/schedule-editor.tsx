'use client'

import { useState } from 'react'
import { Plus, Trash2, Save, Zap } from 'lucide-react'
import { toast } from 'sonner'
import EmptyState from "@/components/ui/empty-state"
import { saveSchedule } from './actions'
import { Button } from '@/components/ui/button'
import { 
  getRecommendedSchedule, 
  convertRecommendationsToSlots,
  HOSPITALITY_QUICK_PRESETS 
} from '@/lib/scheduling/uk-hospitality-defaults'
import type { Database } from '@/lib/types/database'

type PostingSchedule = Database['public']['Tables']['posting_schedules']['Row']

interface ScheduleEditorProps {
  initialSchedule: PostingSchedule[]
  tenantId: string
  businessType: string
}

interface ScheduleSlot {
  id: string
  day_of_week: number
  time: string
  platform: string
  active: boolean
}

const DAYS_OF_WEEK = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday'
]

const PLATFORMS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google_my_business', label: 'Google Business Profile' },
]

export function ScheduleEditor({ initialSchedule, tenantId, businessType }: ScheduleEditorProps) {
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(() => 
    initialSchedule.map(s => ({
      id: s.id,
      day_of_week: s.day_of_week,
      time: s.time,
      platform: s.platform || 'all',
      active: (s as any).is_active !== undefined ? (s as any).is_active !== false : (s as any).active !== false
    }))
  )
  const [saving, setSaving] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  
  const addSlot = (day: number, time: string = '12:00', platform: string = 'all') => {
    const newSlot: ScheduleSlot = {
      id: `new-${Date.now()}-${Math.random()}`,
      day_of_week: day,
      time,
      platform,
      active: true
    }
    setSchedule([...schedule, newSlot])
  }
  
  const removeSlot = (id: string) => {
    setSchedule(schedule.filter(s => s.id !== id))
  }
  
  const updateSlot = (id: string, updates: Partial<ScheduleSlot>) => {
    setSchedule(schedule.map(s => 
      s.id === id ? { ...s, ...updates } : s
    ))
  }
  
  const applyRecommendations = () => {
    const recommendations = getRecommendedSchedule(businessType)
    const slots = convertRecommendationsToSlots(recommendations)
    setSchedule(slots.map(s => ({
      ...s,
      id: `new-${Date.now()}-${Math.random()}`,
      active: (s as any).active !== false
    })))
    toast.success('Applied recommended schedule for your business type')
  }
  
  const applyQuickPreset = (preset: typeof HOSPITALITY_QUICK_PRESETS[0]) => {
    const newSlots: ScheduleSlot[] = []
    // Add this time for all days by default
    for (let day = 0; day < 7; day++) {
      newSlots.push({
        id: `new-${Date.now()}-${Math.random()}-${day}-${preset.time}`,
        day_of_week: day,
        time: preset.time,
        platform: 'all',
        active: true
      })
    }
    setSchedule([...schedule, ...newSlots])
    toast.success(`Added preset time ${preset.time} to all days`)
    setShowQuickAdd(false)
  }
  
  const handleSave = async () => {
    setSaving(true)
    
    try {
      const formData = new FormData()
      formData.append('tenant_id', tenantId)
      formData.append('schedule', JSON.stringify(schedule))
      
      const result = await saveSchedule(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Posting schedule saved successfully')
      }
    } catch (error) {
      toast.error('Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }
  
  // Group slots by day for display
  const slotsByDay = DAYS_OF_WEEK.map((day, index) => ({
    day,
    dayIndex: index,
    slots: schedule
      .filter(s => s.day_of_week === index)
      .sort((a, b) => a.time.localeCompare(b.time))
  }))
  
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Button onClick={applyRecommendations} variant="secondary" className="flex items-center gap-2">
          <Zap className="size-4" />
          Apply Recommended Schedule
        </Button>
        
        <Button onClick={() => setShowQuickAdd(!showQuickAdd)} variant="secondary" className="flex items-center gap-2">
          <Plus className="size-4" />
          Quick Add Preset
        </Button>
        
        <Button onClick={handleSave} loading={saving} className="ml-auto flex items-center gap-2">
          {!saving && <Save className="size-4" />}
          Save Schedule
        </Button>
      </div>
      
      {showQuickAdd && (
        <div className="space-y-2 rounded-medium bg-gray-50 p-4">
          <p className="mb-3 text-sm font-medium">Choose a preset to add:</p>
          <div className="flex flex-wrap gap-2">
            {HOSPITALITY_QUICK_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => applyQuickPreset(preset)}
                className="rounded-medium border border-border bg-white px-3 py-1 text-sm transition-colors hover:border-primary"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      
      <div className="space-y-4">
        {slotsByDay.map(({ day, dayIndex, slots }) => (
          <div key={dayIndex} className="rounded-medium border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-semibold">{day}</h4>
              <button
                onClick={() => addSlot(dayIndex)}
                className="hover:text-primary-dark text-sm text-primary transition-colors"
              >
                <Plus className="mr-1 inline size-4" />
                Add Time
              </button>
            </div>
            
            {slots.length === 0 ? (
              <div className="py-2">
                <EmptyState
                  title="No times added"
                  body={<span className="text-sm">Use Add Time to schedule posts for this day.</span>}
                  primaryCta={{ label: 'Add Time', onClick: () => addSlot(dayIndex) }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center gap-3 rounded-soft bg-gray-50 p-2"
                  >
                    <input
                      type="time"
                      value={slot.time}
                      onChange={(e) => updateSlot(slot.id, { time: e.target.value })}
                      className="rounded-soft border border-border px-2 py-1 text-sm"
                    />
                    
                    <select
                      value={slot.platform}
                      onChange={(e) => updateSlot(slot.id, { platform: e.target.value })}
                      className="rounded-soft border border-border px-2 py-1 text-sm"
                    >
                      {PLATFORMS.map(p => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={slot.active}
                        onChange={(e) => updateSlot(slot.id, { active: e.target.checked })}
                        className="rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                      Active
                    </label>
                    
                    <button
                      onClick={() => removeSlot(slot.id)}
                      className="hover:text-error-dark ml-auto text-error transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      
      <div className="text-sm text-text-secondary">
        <p>💡 Tip: Schedule posts when your audience is most active. Lunch (12-2pm) and evening (5-7pm) typically see high engagement for hospitality businesses.</p>
      </div>
    </div>
  )
}
