import { NextResponse } from 'next/server'
import { metrics } from '@/lib/observability/metrics'

export const runtime = 'nodejs'

export async function GET() {
  const summary = metrics.getMetricsSummary()
  return NextResponse.json({ ok: true, metrics: summary })
}

