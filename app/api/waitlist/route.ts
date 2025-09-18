import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createRequestLogger, logger } from '@/lib/observability/logger'

const schema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: Request) {
  const reqLogger = createRequestLogger(req)
  try {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ message: 'Invalid email' }, { status: 400 })
    }

    const email = parsed.data.email.trim().toLowerCase()

    const supabase = await createServiceRoleClient()

    // Insert and gracefully handle duplicates as success
    const { error } = await supabase
      .from('waitlist_subscribers')
      .insert({ email })

    if (error) {
      if ((error as any)?.code === '23505') {
        reqLogger.info('Waitlist email already subscribed', {
          area: 'waitlist',
          op: 'subscribe',
          status: 'duplicate',
          meta: { email },
        })
        return NextResponse.json({ ok: true })
      }
      reqLogger.error('Waitlist insert error', {
        area: 'waitlist',
        op: 'subscribe',
        status: 'fail',
        error,
        meta: { email },
      })
      logger.error('Waitlist insert error', {
        area: 'waitlist',
        op: 'subscribe',
        status: 'fail',
        error,
      })
      return NextResponse.json({ message: 'Something went wrong' }, { status: 500 })
    }

    reqLogger.info('Waitlist subscription added', {
      area: 'waitlist',
      op: 'subscribe',
      status: 'ok',
      meta: { email },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    reqLogger.error('Invalid waitlist request', {
      area: 'waitlist',
      op: 'subscribe',
      status: 'fail',
      error: err,
    })
    logger.error('Invalid waitlist request', {
      area: 'waitlist',
      op: 'subscribe',
      status: 'fail',
      error: err,
    })
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 })
  }
}

export async function GET() {
  // Do not expose the list publicly
  return NextResponse.json({ message: 'Not found' }, { status: 404 })
}
