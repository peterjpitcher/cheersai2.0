'use client'

import { useState } from 'react'
import { Plus, Trash2, Save, Zap } from 'lucide-react'
import { toast } from 'sonner'
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
  is_active: boolean
}

const DAYS_OF_WEEK = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday'
]

const PLATFORMS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter/X' },
]

export function ScheduleEditor({ initialSchedule, tenantId, businessType }: ScheduleEditorProps) {
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(() => 
    initialSchedule.map(s => ({
      id: s.id,
      day_of_week: s.day_of_week,
      time: s.time,
      platform: s.platform || 'all',
      is_active: s.is_active !== false
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
      is_active: true
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
      id: `new-${Date.now()}-${Math.random()}`
    })))
    toast.success('Applied recommended schedule for your business type')
  }
  
  const applyQuickPreset = (preset: typeof HOSPITALITY_QUICK_PRESETS[0]) => {
    const newSlots: ScheduleSlot[] = []
    preset.days.forEach(day => {
      preset.times.forEach(time => {
        newSlots.push({
          id: `new-${Date.now()}-${Math.random()}-${day}-${time}`,
          day_of_week: day,
          time,
          platform: 'all',
          is_active: true
        })
      })
    })
    setSchedule([...schedule, ...newSlots])
    toast.success(`Added ${preset.name} schedule`)
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
          <Zap className="w-4 h-4" />
          Apply Recommended Schedule
        </Button>
        
        <Button onClick={() => setShowQuickAdd(!showQuickAdd)} variant="secondary" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Quick Add Preset
        </Button>
        
        <Button onClick={handleSave} disabled={saving} className="flex items-center gap-2 ml-auto">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Schedule'}
        </Button>
      </div>
      
      {showQuickAdd && (
        <div className="p-4 bg-gray-50 rounded-medium space-y-2">
          <p className="text-sm font-medium mb-3">Choose a preset to add:</p>
          <div className="flex flex-wrap gap-2">
            {HOSPITALITY_QUICK_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyQuickPreset(preset)}
                className="px-3 py-1 bg-white border border-border rounded-medium hover:border-primary transition-colors text-sm"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}
      
      <div className="space-y-4">
        {slotsByDay.map(({ day, dayIndex, slots }) => (
          <div key={dayIndex} className="border border-border rounded-medium p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">{day}</h4>
              <button
                onClick={() => addSlot(dayIndex)}
                className="text-sm text-primary hover:text-primary-dark transition-colors"
              >
                <Plus className="w-4 h-4 inline mr-1" />
                Add Time
              </button>
            </div>
            
            {slots.length === 0 ? (
              <p className="text-sm text-text-secondary">No posts scheduled</p>
            ) : (
              <div className="space-y-2">
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center gap-3 p-2 bg-gray-50 rounded-soft"
                  >
                    <input
                      type="time"
                      value={slot.time}
                      onChange={(e) => updateSlot(slot.id, { time: e.target.value })}
                      className="px-2 py-1 border border-border rounded-soft text-sm"
                    />
                    
                    <select
                      value={slot.platform}
                      onChange={(e) => updateSlot(slot.id, { platform: e.target.value })}
                      className="px-2 py-1 border border-border rounded-soft text-sm"
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
                        checked={slot.is_active}
                        onChange={(e) => updateSlot(slot.id, { is_active: e.target.checked })}
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      Active
                    </label>
                    
                    <button
                      onClick={() => removeSlot(slot.id)}
                      className="ml-auto text-error hover:text-error-dark transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
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
