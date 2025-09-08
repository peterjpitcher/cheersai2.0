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
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Attribution</h1>
      {loading ? <p>Loading…</p> : (
        <div>
          <a className="underline" href="/api/reports/attribution.csv">Export CSV</a>
          <div className="mt-4 space-y-3">
            {Object.entries(data?.byDay || {}).map(([day, v]: any) => (
              <div key={day} className="border p-3 rounded">
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

