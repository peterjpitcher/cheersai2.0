import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import type { Database } from '@/lib/types/database'

type ServiceSupabaseClient = SupabaseClient<Database>

type QueueInsert = Pick<
  Database['public']['Tables']['publishing_queue']['Insert'],
  'campaign_post_id' | 'social_connection_id' | 'scheduled_for' | 'status'
>

type QueueRow = Pick<
  Database['public']['Tables']['publishing_queue']['Row'],
  'campaign_post_id' | 'social_connection_id' | 'status' | 'scheduled_for'
>

type ScheduledPost = Pick<
  Database['public']['Tables']['campaign_posts']['Row'],
  'id' | 'tenant_id' | 'platform' | 'platforms' | 'scheduled_for'
>

type ActiveConnection = Pick<
  Database['public']['Tables']['social_connections']['Row'],
  'id' | 'tenant_id' | 'platform'
>

type EnsureOptions = {
  lookaheadMinutes?: number
  graceMinutes?: number
}

const DEFAULT_LOOKAHEAD_MINUTES = 60 * 24 * 60
const DEFAULT_GRACE_MINUTES = 6 * 60

export async function ensureScheduledPostsEnqueued(
  supabase: ServiceSupabaseClient,
  opts: EnsureOptions = {},
): Promise<void> {
  const lookaheadMinutes = opts.lookaheadMinutes ?? DEFAULT_LOOKAHEAD_MINUTES
  const graceMinutes = opts.graceMinutes ?? DEFAULT_GRACE_MINUTES

  const horizon = new Date(Date.now() + lookaheadMinutes * 60_000).toISOString()
  const since = new Date(Date.now() - graceMinutes * 60_000).toISOString()

  const { data: scheduledPostsRaw, error: postsError } = await supabase
    .from('campaign_posts')
    .select('id, tenant_id, platform, platforms, scheduled_for')
    .eq('status', 'scheduled')
    .eq('approval_status', 'approved')
    .is('deleted_at', null)
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', since)
    .lte('scheduled_for', horizon)

  if (postsError) {
    logger.error('queue.reconcile: failed to load scheduled posts', {
      area: 'queue',
      op: 'reconcile.fetchPosts',
      error: postsError,
    })
    return
  }

  const scheduledPosts = (scheduledPostsRaw ?? []).filter((post): post is ScheduledPost => {
    return Boolean(post.id && post.tenant_id && post.scheduled_for)
  })
  if (scheduledPosts.length === 0) {
    return
  }

  const postIds = Array.from(new Set(scheduledPosts.map(post => post.id)))
  const tenantIds = Array.from(new Set(scheduledPosts.map(post => post.tenant_id!)))

  const { data: queueRowsRaw, error: queueError } = await supabase
    .from('publishing_queue')
    .select('campaign_post_id, social_connection_id, status, scheduled_for')
    .in('campaign_post_id', postIds)

  if (queueError) {
    logger.error('queue.reconcile: failed to load queue snapshot', {
      area: 'queue',
      op: 'reconcile.fetchQueue',
      error: queueError,
    })
    return
  }

  const queueRows = (queueRowsRaw ?? []) as QueueRow[]
  const existingMap = new Map<string, QueueRow>()
  for (const row of queueRows) {
    if (!row.campaign_post_id || !row.social_connection_id) continue
    existingMap.set(`${row.campaign_post_id}::${row.social_connection_id}`, row)
  }

  const { data: connectionsRaw, error: connectionsError } = await supabase
    .from('social_connections')
    .select('id, tenant_id, platform')
    .in('tenant_id', tenantIds)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (connectionsError) {
    logger.error('queue.reconcile: failed to load connections', {
      area: 'queue',
      op: 'reconcile.fetchConnections',
      error: connectionsError,
    })
    return
  }

  const connections = (connectionsRaw ?? []).filter((conn): conn is ActiveConnection => {
    return Boolean(conn.id && conn.tenant_id && conn.platform)
  })

  if (connections.length === 0) {
    return
  }

  const connectionsByTenant = new Map<string, ActiveConnection[]>()
  for (const conn of connections) {
    const list = connectionsByTenant.get(conn.tenant_id!) ?? []
    list.push(conn)
    connectionsByTenant.set(conn.tenant_id!, list)
  }

  const pendingUpdates: Array<{ postId: string; connectionId: string; newSchedule: string }> = []
  const inserts: QueueInsert[] = []

  for (const post of scheduledPosts) {
    const tenantId = post.tenant_id!
    const targetPlatform = normalisePlatform(
      post.platform ?? (Array.isArray(post.platforms) ? post.platforms[0] ?? null : null) ?? 'facebook',
    )
    const tenantConnections = connectionsByTenant.get(tenantId) ?? []
    if (tenantConnections.length === 0) continue

    for (const connection of tenantConnections) {
      const normalisedConnectionPlatform = normalisePlatform(connection.platform)
      if (normalisedConnectionPlatform !== targetPlatform) continue

      const key = `${post.id}::${connection.id}`
      const existing = existingMap.get(key)

      if (!existing) {
        inserts.push({
          campaign_post_id: post.id,
          social_connection_id: connection.id,
          scheduled_for: post.scheduled_for!,
          status: 'pending',
        })
        continue
      }

      if (
        existing.status === 'pending' &&
        existing.scheduled_for !== post.scheduled_for
      ) {
        pendingUpdates.push({
          postId: post.id,
          connectionId: connection.id,
          newSchedule: post.scheduled_for!,
        })
      }
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await supabase
      .from('publishing_queue')
      .insert(inserts)

    if (insertError) {
      logger.error('queue.reconcile: failed to insert queue entries', {
        area: 'queue',
        op: 'reconcile.insert',
        error: insertError,
        meta: { attempted: inserts.length },
      })
    } else {
      logger.info('queue.reconcile: inserted queue entries', {
        area: 'queue',
        op: 'reconcile.insert',
        status: 'ok',
        meta: { inserted: inserts.length },
      })
    }
  }

  if (pendingUpdates.length > 0) {
    let updatedCount = 0
    for (const update of pendingUpdates) {
      const { error: updateError } = await supabase
        .from('publishing_queue')
        .update({ scheduled_for: update.newSchedule, next_attempt_at: null })
        .eq('campaign_post_id', update.postId)
        .eq('social_connection_id', update.connectionId)
        .eq('status', 'pending')

      if (updateError) {
        logger.warn('queue.reconcile: failed to sync queue schedule', {
          area: 'queue',
          op: 'reconcile.update',
          error: updateError,
          meta: { postId: update.postId, connectionId: update.connectionId },
        })
      } else {
        updatedCount += 1
      }
    }

    if (updatedCount > 0) {
      logger.info('queue.reconcile: updated queue entries', {
        area: 'queue',
        op: 'reconcile.update',
        status: 'ok',
        meta: { updated: updatedCount },
      })
    }
  }
}

function normalisePlatform(value: string | null): string {
  if (!value) return 'facebook'
  return value === 'instagram' ? 'instagram_business' : value
}
