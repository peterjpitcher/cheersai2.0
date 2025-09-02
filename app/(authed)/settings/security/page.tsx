import { getUserAndTenant } from '@/lib/settings/service'
import { PasswordForm } from './password-form'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SecuritySettingsPage() {
  const { user } = await getUserAndTenant()
  
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-xl font-heading font-bold mb-2">Change Password</h2>
        <p className="text-text-secondary text-sm mb-6">
          Update your password to keep your account secure
        </p>
        
        <PasswordForm />
      </div>
      
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <h2 className="text-xl font-heading font-bold mb-4">Security Information</h2>
        
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Password Requirements</h3>
            <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
              <li>Minimum 8 characters long</li>
              <li>Include at least one uppercase letter</li>
              <li>Include at least one lowercase letter</li>
              <li>Include at least one number</li>
              <li>Include at least one special character</li>
            </ul>
          </div>
          
          <div className="pt-4 border-t border-border">
            <h3 className="font-semibold mb-2">Two-Factor Authentication</h3>
            <p className="text-sm text-text-secondary mb-3">
              Two-factor authentication adds an extra layer of security to your account.
            </p>
            <p className="text-sm text-text-secondary">
              2FA is currently not enabled. Contact support to enable this feature.
            </p>
          </div>
          
          <div className="pt-4 border-t border-border">
            <h3 className="font-semibold mb-2">Recent Activity</h3>
            <p className="text-sm text-text-secondary">
              Last login: {new Date(user.last_sign_in_at || '').toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}