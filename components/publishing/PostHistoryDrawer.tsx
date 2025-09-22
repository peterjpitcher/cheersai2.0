"use client";

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type AuditMeta = Record<string, unknown> | null
type RevisionDiff = Record<string, unknown> | null

type AuditEntry = {
  id: string;
  ts: string;
  user_id?: string | null;
  action: string;
  meta?: AuditMeta;
}

type RevisionEntry = {
  id: string;
  ts: string;
  version: number;
  diff: RevisionDiff;
  user_id?: string | null;
}

interface PostHistoryDrawerProps {
  postId: string;
  open: boolean;
  onClose: () => void;
}

const formatDateTime = (value: string) => new Date(value).toLocaleString()

export default function PostHistoryDrawer({ postId, open, onClose }: PostHistoryDrawerProps) {
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [revs, setRevs] = useState<RevisionEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    setLoading(true)
    ;(async () => {
      try {
        const { data: auditRows, error: auditError } = await supabase
          .from('audit_log')
          .select('id, ts, user_id, action, meta')
          .eq('entity_type', 'campaign_post')
          .eq('entity_id', postId)
          .order('ts', { ascending: false })

        if (auditError) {
          console.error('Failed to load audit log', auditError)
        }

        const { data: revisionRows, error: revisionError } = await supabase
          .from('post_revisions')
          .select('id, ts, version, diff, user_id')
          .eq('post_id', postId)
          .order('version', { ascending: false })

        if (revisionError) {
          console.error('Failed to load revisions', revisionError)
        }

        setAudit(auditRows ?? [])
        setRevs(revisionRows ?? [])
      } finally {
        setLoading(false)
      }
    })()
  }, [open, postId])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        className="fixed inset-0 bg-black/30"
        onClick={onClose}
        aria-label="Close post history"
      />
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
                    <div className="text-xs text-text-secondary">{formatDateTime(e.ts)}</div>
                  </div>
                  {e.meta && (
                    <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(e.meta, null, 2)}
                    </pre>
                  )}
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
                    <div className="text-xs text-text-secondary">{formatDateTime(r.ts)}</div>
                  </div>
                  {r.diff && (
                    <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(r.diff, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
