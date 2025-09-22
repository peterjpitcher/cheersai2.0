import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/database.types'

export async function recordPqlEvent(
  tenantId: string,
  userId: string | null,
  eventType: string,
  metadata?: Json,
) {
  const supabase = await createClient()
  const payload = {
    tenant_id: tenantId,
    user_id: userId,
    event_type: eventType,
    ...(typeof metadata !== 'undefined' ? { metadata } : {}),
  }
  await supabase.from('pql_events').insert(payload).throwOnError()
}
