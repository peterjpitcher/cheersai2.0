import { createClient } from '@/lib/supabase/server'

export type SuperadminContext = {
  user: {
    id: string
    email?: string
  }
  profileEmail?: string | null
}

export class SuperadminRequiredError extends Error {
  constructor(public readonly reason: 'unauthenticated' | 'forbidden') {
    super(reason)
    this.name = 'SuperadminRequiredError'
  }
}

export async function requireSuperadmin(): Promise<SuperadminContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new SuperadminRequiredError('unauthenticated')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('is_superadmin, email')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_superadmin) {
    throw new SuperadminRequiredError('forbidden')
  }

  return {
    user: { id: user.id, email: user.email ?? undefined },
    profileEmail: profile?.email ?? user.email ?? null,
  }
}
