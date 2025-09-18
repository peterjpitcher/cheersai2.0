"use client"
import { useEffect, useState } from 'react'

export default function AttributionReport() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/reports/attribution')
      const json = await res.json()
      setData(json.data || json)
      setLoading(false)
    })()
  }, [])
  return (
    <div>
      <h1 className="mb-4 font-heading text-title-sm font-bold">Attribution</h1>
      {loading ? <p>Loading…</p> : (
        <div>
          <a className="underline" href="/api/reports/attribution.csv">Export CSV</a>
          <div className="mt-4 space-y-3">
            {Object.entries(data?.byDay || {}).map(([day, v]: any) => (
              <div key={day} className="rounded-card border p-3">
                <div className="font-medium">{day}</div>
                <div>Total clicks: {v.total}</div>
                <div className="text-xs text-muted-foreground">{Object.entries(v.byPlatform).map(([k, n]: any) => `${k}: ${n}`).join(', ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
