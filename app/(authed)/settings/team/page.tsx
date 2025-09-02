import { getUserAndTenant } from '@/lib/settings/service'
import { createClient } from '@/lib/supabase/server'
import { TeamMembersList } from './team-list'
import { InviteForm } from './invite-form'
import { Users, UserPlus } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getTeamMembers(tenantId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, role, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  
  return data || []
}

async function getPendingInvitations(tenantId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
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
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-heading font-bold">Team Members</h2>
        </div>
        <p className="text-text-secondary text-sm mb-6">
          Manage your team members and their access levels
        </p>
        
        <TeamMembersList 
          members={teamMembers}
          currentUserId={user.id}
          currentUserRole={user.role}
          tenantId={tenant.id}
        />
      </div>
      
      {canManageTeam && (
        <div className="bg-white rounded-large shadow-sm border border-border p-6">
          <div className="flex items-center gap-3 mb-2">
            <UserPlus className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-heading font-bold">Invite Team Member</h3>
          </div>
          <p className="text-text-secondary text-sm mb-6">
            Send an invitation to add a new team member
          </p>
          
          <InviteForm 
            tenantId={tenant.id}
            currentPlan={tenant.subscription_tier || 'trial'}
            currentMemberCount={teamMembers.length}
          />
          
          {pendingInvitations.length > 0 && (
            <div className="mt-6 pt-6 border-t border-border">
              <h4 className="font-medium mb-3">Pending Invitations</h4>
              <div className="space-y-2">
                {pendingInvitations.map(invite => (
                  <div key={invite.id} className="flex items-center justify-between p-3 bg-surface rounded-medium">
                    <div>
                      <p className="font-medium">{invite.email}</p>
                      <p className="text-sm text-text-secondary">
                        Role: {invite.role} • Sent {new Date(invite.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
        <h3 className="font-medium mb-2">Team Member Limits by Plan</h3>
        <div className="grid md:grid-cols-3 gap-4 mt-3">
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