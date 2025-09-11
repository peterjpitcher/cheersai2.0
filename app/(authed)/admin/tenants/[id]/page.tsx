import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'

interface TenantDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function TenantDetailPage({ params }: TenantDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()
  
  // Check admin access
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: currentUser } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single()

  if (!currentUser || currentUser.role !== 'super_admin') {
    redirect('/dashboard')
  }

  // Fetch tenant details
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(`
      *,
      users:users!tenant_id (
        id,
        email,
        first_name,
        last_name,
        role,
        created_at,
        last_sign_in_at
      ),
      campaigns:campaigns!tenant_id (
        id,
        name,
        status,
        created_at
      ),
      posts:campaign_posts!tenant_id (
        id,
        platform,
        status,
        created_at
      )
    `)
    .eq('id', id)
    .single()

  if (error || !tenant) {
    notFound()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link 
          href="/admin/tenants"
          className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Tenants
        </Link>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-text-secondary">Tenant Details & Management</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Basic Info */}
        <div className="bg-card p-6 rounded-large border">
          <h2 className="text-lg font-medium mb-4">Basic Information</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-text-secondary">Name</label>
              <p className="font-medium">{tenant.name}</p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Slug</label>
              <p className="font-mono text-sm">{tenant.slug}</p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Status</label>
              <p className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                tenant.subscription_status === 'active' ? 'bg-green-100 text-green-800' :
                tenant.subscription_status === 'trial' ? 'bg-blue-100 text-blue-800' :
                'bg-red-100 text-red-800'
              }`}>
                {tenant.subscription_status}
              </p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Plan</label>
              <p className="capitalize">{tenant.subscription_tier || 'Free'}</p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Created</label>
              <p className="text-sm">{new Date(tenant.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Usage Stats */}
        <div className="bg-card p-6 rounded-large border">
          <h2 className="text-lg font-medium mb-4">Usage Statistics</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-text-secondary">Users</label>
              <p className="text-2xl font-semibold">{tenant.users?.length || 0}</p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Campaigns</label>
              <p className="text-2xl font-semibold">{tenant.campaigns?.length || 0}</p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Posts</label>
              <p className="text-2xl font-semibold">{tenant.posts?.length || 0}</p>
            </div>
            <div>
              <label className="text-sm text-text-secondary">Trial Campaigns Used</label>
              <p className="text-lg">{tenant.total_campaigns_created || 0}</p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-card p-6 rounded-large border">
          <h2 className="text-lg font-medium mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <button className="w-full text-left px-3 py-2 text-sm rounded-medium hover:bg-background">
              View Campaigns
            </button>
            <button className="w-full text-left px-3 py-2 text-sm rounded-medium hover:bg-background">
              View Users
            </button>
            <button className="w-full text-left px-3 py-2 text-sm rounded-medium hover:bg-background">
              Usage Reports
            </button>
            <hr className="my-3" />
            <button className="w-full text-left px-3 py-2 text-sm rounded-medium hover:bg-red-50 text-red-600">
              Suspend Tenant
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      {tenant.users && tenant.users.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium mb-4">Team Members</h2>
          <div className="bg-card rounded-large border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background">
                  <tr>
                    <th className="text-left px-6 py-3 text-sm font-medium">User</th>
                    <th className="text-left px-6 py-3 text-sm font-medium">Role</th>
                    <th className="text-left px-6 py-3 text-sm font-medium">Joined</th>
                    <th className="text-left px-6 py-3 text-sm font-medium">Last Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tenant.users.map((user: any) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium">{user.first_name} {user.last_name}</p>
                          <p className="text-sm text-text-secondary">{user.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}