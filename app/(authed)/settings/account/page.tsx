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
          <h2 className="text-xl font-heading font-bold mb-2">Account Information</h2>
          <p className="text-text-secondary text-sm mb-6">
            Manage your personal information and account preferences
          </p>
          <AccountForm user={user} tenant={tenant} weekStart={weekStart} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-6">
          <h2 className="text-xl font-heading font-bold mb-4">Account Actions</h2>
          <div className="space-y-4">
            <div className="pb-4 border-b border-border">
              <h3 className="font-semibold mb-2">Export Your Data</h3>
              <p className="text-sm text-text-secondary mb-3">
                Download a copy of your CheersAI data including campaigns, posts, and settings.
              </p>
              <Button variant="secondary">Request Data Export</Button>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-error">Delete Account</h3>
              <p className="text-sm text-text-secondary mb-3">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              <Button variant="outline" className="text-error border-error hover:bg-error/5">Delete Account</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
