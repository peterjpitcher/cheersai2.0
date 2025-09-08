import { NextRequest, NextResponse } from 'next/server'
import { orchestrateInspiration } from '@/lib/inspiration/orchestrator'

export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  const hasVercelCronHeader = request.headers.get('x-vercel-cron') === '1'
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (!hasVercelCronHeader) {
    if (!secret || secret !== process.env.CRON_SECRET) return new NextResponse('forbidden', { status: 403 })
  }

  const from = request.nextUrl.searchParams.get('from') || undefined
  const to = request.nextUrl.searchParams.get('to') || undefined
  const dry = request.nextUrl.searchParams.get('dry') === '1'
  const forceBriefs = request.nextUrl.searchParams.get('forceBriefs') === '1'

  try {
    const res = await orchestrateInspiration({ from, to, dryRun: dry, forceBriefs })
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    console.error('Inspiration cron failed', e)
    return NextResponse.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
