import { NextRequest, NextResponse } from 'next/server'
import { metrics } from '@/lib/observability/metrics'
import { requireSuperadmin, SuperadminRequiredError } from '@/lib/security/superadmin'
import { unauthorized, forbidden } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    await requireSuperadmin()
  } catch (error) {
    if (error instanceof SuperadminRequiredError) {
      if (error.reason === 'unauthenticated') {
        return unauthorized('Authentication required', undefined, request)
      }
      if (error.reason === 'forbidden') {
        return forbidden('Forbidden', undefined, request)
      }
    }
    throw error
  }

  const summary = metrics.getMetricsSummary()
  return NextResponse.json({ ok: true, metrics: summary })
}
