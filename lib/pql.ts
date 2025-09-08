import { createClient } from '@/lib/supabase/server'

export async function recordPqlEvent(tenantId: string, userId: string | null, eventType: string, metadata?: Record<string, unknown>) {
  const supabase = await createClient()
  await supabase.from('pql_events').insert({ tenant_id: tenantId, user_id: userId, event_type: eventType, metadata }).throwOnError()
}

