"use client";

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type WeekStart = 'sunday' | 'monday'

export function useWeekStart(): { weekStart: WeekStart; index: 0|1; loading: boolean } {
  const [weekStart, setWeekStart] = useState<WeekStart>('monday')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Try cached value first
        const cached = typeof window !== 'undefined' ? window.localStorage.getItem('cheers.week_start') : null
        if (cached === 'sunday' || cached === 'monday') {
          setWeekStart(cached)
        }
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }
        const { data } = await supabase
          .from('user_prefs')
          .select('week_start')
          .eq('user_id', user.id)
          .maybeSingle()
        const ws = (data?.week_start === 'sunday' || data?.week_start === 'monday') ? data.week_start : (cached as WeekStart) || 'monday'
        if (!cancelled) {
          setWeekStart(ws)
          try { window.localStorage.setItem('cheers.week_start', ws) } catch {}
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return { weekStart, index: (weekStart === 'monday' ? 1 : 0), loading }
}

