"use client"
import { useEffect, useState } from 'react'

interface AttributionDay {
  total: number;
  byPlatform: Record<string, number>;
}

interface AttributionReportData {
  byDay: Record<string, AttributionDay>;
}

export default function AttributionReport() {
  const [data, setData] = useState<AttributionReportData | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/reports/attribution')
      const json = await res.json()
      const payload = (json?.data ?? json) as Partial<AttributionReportData>
      setData({
        byDay: payload.byDay ?? {},
      })
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
            {Object.entries(data?.byDay ?? {}).map(([day, value]) => (
              <div key={day} className="rounded-card border p-3">
                <div className="font-medium">{day}</div>
                <div>Total clicks: {value.total}</div>
                <div className="text-xs text-muted-foreground">
                  {Object.entries(value.byPlatform).map(([platform, count]) => `${platform}: ${count}`).join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
