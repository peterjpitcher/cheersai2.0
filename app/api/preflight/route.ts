import { NextRequest } from 'next/server'
import { preflight } from '@/lib/preflight'
import { badRequest, ok } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.text !== 'string' || typeof body.platform !== 'string') {
    return badRequest('validation_error', 'text and platform required')
  }
  const result = preflight(body.text, body.platform)
  return ok(result, request)
}

