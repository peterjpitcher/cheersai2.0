"use client";

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Entry = { id: string; ts: string; user_id?: string; action: string; meta?: any }
type Revision = { id: string; ts: string; version: number; diff: any; user_id?: string }

export default function PostHistoryDrawer({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const [audit, setAudit] = useState<Entry[]>([])
  const [revs, setRevs] = useState<Revision[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    setLoading(true)
    ;(async () => {
      const { data: a } = await supabase.from('audit_log').select('id, ts, user_id, action, meta').eq('entity_type', 'campaign_post').eq('entity_id', postId).order('ts', { ascending: false })
      const { data: r } = await supabase.from('post_revisions').select('id, ts, version, diff, user_id').eq('post_id', postId).order('version', { ascending: false })
      setAudit(a || [])
      setRevs(r || [])
      setLoading(false)
    })()
  }, [open, postId])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="ml-auto size-full max-w-md overflow-y-auto border-l border-border bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Post History</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label="Close"><X className="size-5" /></button>
        </div>
        {loading ? (
          <div className="text-sm text-text-secondary">Loading…</div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Audit Events</h3>
              {audit.length === 0 ? (
                <p className="text-xs text-text-secondary">No audit events.</p>
              ) : audit.map(e => (
                <div key={e.id} className="border-b border-border py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-medium capitalize">{e.action.replace('_', ' ')}</div>
                    <div className="text-xs text-text-secondary">{new Date(e.ts).toLocaleString()}</div>
                  </div>
                  {e.meta && <pre className="mt-1 whitespace-pre-wrap break-words text-xs">{JSON.stringify(e.meta, null, 2)}</pre>}
                </div>
              ))}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Revisions</h3>
              {revs.length === 0 ? (
                <p className="text-xs text-text-secondary">No revisions.</p>
              ) : revs.map(r => (
                <div key={r.id} className="border-b border-border py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div>v{r.version}</div>
                    <div className="text-xs text-text-secondary">{new Date(r.ts).toLocaleString()}</div>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs">{JSON.stringify(r.diff, null, 2)}</pre>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

