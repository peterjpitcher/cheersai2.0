"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ApprovalRow {
  id: string
  status: string
  campaign?: { name?: string } | null
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState<ApprovalRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/posts?filter=pending-approval')
        if (res.ok) {
          const json = await res.json()
          setRows(json.data?.posts || [])
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div>
      <h1 className="text-title-sm font-heading font-bold mb-4">Review Queue</h1>
      {loading ? <p>Loading…</p> : rows.length === 0 ? <p>No posts pending approval.</p> : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left border-b"><th className="py-2">Post</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b">
                <td className="py-2">{r.campaign?.name || 'Quick Post'} ({r.id.slice(0,8)})</td>
                <td>{r.status}</td>
                <td className="space-x-2">
                  <Link className="underline" href={`/posts/${r.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
