import { getUserAndTenant } from '@/lib/settings/service'
import { PasswordForm } from './password-form'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/lib/datetime'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SecuritySettingsPage() {
  const { user } = await getUserAndTenant()
  // The application stores user metadata in DB; last login timestamp is not available here.
  const lastLogin = 'Not available'

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-2 font-heading text-xl font-bold">Change Password</h2>
          <p className="mb-6 text-sm text-text-secondary">
            Update your password to keep your account secure
          </p>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 font-heading text-xl font-bold">Security Information</h2>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 font-semibold">Password Requirements</h3>
              <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
                <li>Minimum 8 characters long</li>
                <li>Include at least one uppercase letter</li>
                <li>Include at least one lowercase letter</li>
                <li>Include at least one number</li>
                <li>Include at least one special character</li>
              </ul>
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="mb-2 font-semibold">Two-Factor Authentication</h3>
              <p className="mb-3 text-sm text-text-secondary">
                Two-factor authentication adds an extra layer of security to your account.
              </p>
              <p className="text-sm text-text-secondary">
                2FA is currently not enabled. Contact support to enable this feature.
              </p>
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="mb-2 font-semibold">Recent Activity</h3>
              <p className="text-sm text-text-secondary">Last login: {lastLogin}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
