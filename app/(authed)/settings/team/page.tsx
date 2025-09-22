import { getUserAndTenant } from '@/lib/settings/service'
import { createClient } from '@/lib/supabase/server'
import { TeamMembersList } from './team-list'
import { InviteForm } from './invite-form'
import { Users, UserPlus } from 'lucide-react'
import { formatDate } from '@/lib/datetime'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getTeamMembers(tenantId: string) {
  const supabase = await createClient()
  
  const { data } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, role, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  
  return data || []
}

async function getPendingInvitations(tenantId: string) {
  const supabase = await createClient()
  
  const { data } = await supabase
    .from('team_invitations')
    .select('id, email, role, created_at, expires_at')
    .eq('tenant_id', tenantId)
    .eq('accepted', false)
    .order('created_at', { ascending: false })
  
  return data || []
}

export default async function TeamSettingsPage() {
  const { user, tenant } = await getUserAndTenant()
  const teamMembers = await getTeamMembers(tenant.id)
  const pendingInvitations = await getPendingInvitations(tenant.id)
  
  // Check if user is owner or admin
  const canManageTeam = user.role === 'owner' || user.role === 'admin'
  
  return (
    <div className="space-y-6">
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-3">
          <Users className="size-5 text-primary" />
          <h2 className="font-heading text-xl font-bold">Team Members</h2>
        </div>
        <p className="mb-6 text-sm text-text-secondary">
          Manage your team members and their access levels
        </p>
        
        <TeamMembersList 
          members={teamMembers}
          currentUserId={user.id}
          currentUserRole={user.role || 'member'}
          tenantId={tenant.id}
        />
      </div>
      
      {canManageTeam && (
        <div className="rounded-large border border-border bg-white p-6 shadow-sm">
          <div className="mb-2 flex items-center gap-3">
            <UserPlus className="size-5 text-primary" />
            <h3 className="font-heading text-lg font-bold">Invite Team Member</h3>
          </div>
          <p className="mb-6 text-sm text-text-secondary">
            Send an invitation to add a new team member
          </p>
          
          <InviteForm 
            tenantId={tenant.id}
            currentPlan={tenant.subscription_tier || 'trial'}
            currentMemberCount={teamMembers.length}
          />
          
          {pendingInvitations.length > 0 && (
            <div className="mt-6 border-t border-border pt-6">
              <h4 className="mb-3 font-medium">Pending Invitations</h4>
              <div className="space-y-2">
                {pendingInvitations.map(invite => (
                  <div key={invite.id} className="flex items-center justify-between rounded-medium bg-surface p-3">
                    <div>
                      <p className="font-medium">{invite.email}</p>
                      <p className="text-sm text-text-secondary">Role: {invite.role || 'viewer'} • Sent {invite.created_at ? formatDate(invite.created_at) : 'Unknown date'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      <div className="rounded-medium border border-primary/20 bg-primary/5 p-4">
        <h3 className="mb-2 font-medium">Team Member Limits by Plan</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="text-sm">
            <span className="font-medium">Starter:</span> 2 team members
          </div>
          <div className="text-sm">
            <span className="font-medium">Professional:</span> 5 team members
          </div>
          <div className="text-sm">
            <span className="font-medium">Enterprise:</span> Unlimited
          </div>
        </div>
      </div>
    </div>
  )
}
