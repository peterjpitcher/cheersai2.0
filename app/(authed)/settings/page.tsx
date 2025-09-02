import { redirect } from 'next/navigation'

export default function SettingsPage() {
  // Redirect to account settings as the default
  redirect('/settings/account')
}