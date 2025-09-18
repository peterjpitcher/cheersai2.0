"use client";

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Mail } from 'lucide-react'
import clsx from 'clsx'

export default function WaitlistForm({
  compact = false,
}: { compact?: boolean }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const value = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Please enter a valid email address')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value })
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.message || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setSubmitted(true)
      setLoading(false)
    } catch (err) {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className={clsx('rounded-md border border-green-200 bg-green-50 p-4 text-green-900', compact && 'p-3')}
           role="status" aria-live="polite">
        Thanks! You’re on the waitlist. We’ll email you when it’s ready.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className={clsx('w-full', compact ? 'space-y-2' : 'space-y-3')}>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
          {error}
        </div>
      )}
      <div className={clsx('flex w-full', compact ? 'flex-col gap-2' : 'flex-col items-stretch gap-2 sm:flex-row')}>
        <div className="relative grow">
          {!compact && <Label htmlFor="waitlist-email" className="sr-only">Email</Label>}
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary/60" />
          <Input
            id="waitlist-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="your@email.com"
            className={clsx('pl-9', compact ? 'h-9' : '')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-describedby="waitlist-help"
          />
        </div>
        <Button type="submit" disabled={loading} className={clsx(compact ? 'h-9' : '')}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : 'Join Waitlist'}
        </Button>
      </div>
      <p id="waitlist-help" className="text-xs text-text-secondary">
        We will only store your email to contact you about availability.
      </p>
    </form>
  )
}

