import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { unstable_noStore as noStore } from 'next/cache'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  noStore()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/')
  }

  // Gate strictly on onboarding_complete to prevent ping‑pong
  const { data: userRow } = await supabase
    .from('users')
    .select('onboarding_complete')
    .eq('id', user.id)
    .single()

  if (userRow?.onboarding_complete) {
    redirect('/dashboard')
  }

  return <>{children}</>
}
