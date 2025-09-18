import { getUserAndTenant } from '@/lib/settings/service'
import { createClient } from '@/lib/supabase/server'
import { AccountForm } from './account-form'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AccountSettingsPage() {
  const { user, tenant } = await getUserAndTenant()
  const supabase = await createClient()
  const { data: pref } = await supabase
    .from('user_prefs')
    .select('week_start')
    .eq('user_id', user.id)
    .maybeSingle()
  const weekStart = (pref?.week_start === 'sunday' || pref?.week_start === 'monday') ? pref.week_start : 'monday'
  
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-2 font-heading text-xl font-bold">Account Information</h2>
          <p className="mb-6 text-sm text-text-secondary">
            Manage your personal information and account preferences
          </p>
          <AccountForm user={user} tenant={tenant} weekStart={weekStart} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 font-heading text-xl font-bold">Account Actions</h2>
          <div className="space-y-4">
            <div className="border-b border-border pb-4">
              <h3 className="mb-2 font-semibold">Export Your Data</h3>
              <p className="mb-3 text-sm text-text-secondary">
                Download a copy of your CheersAI data including campaigns, posts, and settings.
              </p>
              <Button variant="secondary">Request Data Export</Button>
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-error">Delete Account</h3>
              <p className="mb-3 text-sm text-text-secondary">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              <Button variant="outline" className="border-error text-error hover:bg-error/5">Delete Account</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
