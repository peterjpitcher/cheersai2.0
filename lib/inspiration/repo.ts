import { createClient } from '@/lib/supabase/server'
import type { InspirationItem, UserPrefsRecord } from './types'

export async function getUserPrefs(): Promise<{ show_sports: boolean; show_alcohol: boolean }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) return { show_sports: true, show_alcohol: true }

  const { data } = await supabase
    .from('user_prefs')
    .select('show_sports, show_alcohol')
    .eq('user_id', userId)
    .maybeSingle()

  return {
    show_sports: data?.show_sports ?? true,
    show_alcohol: data?.show_alcohol ?? true,
  }
}

export async function setUserPrefs(input: Partial<Pick<UserPrefsRecord, 'show_sports' | 'show_alcohol'>>): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) return { ok: false }

  const payload = {
    user_id: userId,
    show_sports: input.show_sports ?? true,
    show_alcohol: input.show_alcohol ?? true,
  }

  await supabase.from('user_prefs').upsert(payload, { onConflict: 'user_id' })
  return { ok: true }
}

export async function getInspirationRange(fromISO: string, toISO: string): Promise<InspirationItem[]> {
  void fromISO
  void toISO
  // Placeholder: data selection to be implemented in subsequent PRs with joins to events/occurrences/briefs
  return []
}
