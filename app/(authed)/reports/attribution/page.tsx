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
      <h1 className="text-title-sm font-heading font-bold mb-4">Attribution</h1>
      {loading ? <p>Loading…</p> : (
        <div>
          <a className="underline" href="/api/reports/attribution.csv">Export CSV</a>
          <div className="mt-4 space-y-3">
            {Object.entries(data?.byDay || {}).map(([day, v]: any) => (
              <div key={day} className="border p-3 rounded-card">
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
