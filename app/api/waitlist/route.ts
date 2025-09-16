import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'

const schema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: Request) {
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
      // Unique violation (duplicate email)
      if ((error as any)?.code === '23505') {
        return NextResponse.json({ ok: true })
      }
      console.error('Waitlist insert error:', error)
      return NextResponse.json({ message: 'Something went wrong' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 })
  }
}

export async function GET() {
  // Do not expose the list publicly
  return NextResponse.json({ message: 'Not found' }, { status: 404 })
}

