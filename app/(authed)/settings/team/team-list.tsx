'use client'

import { useState } from 'react'
import { Shield, User, Edit2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateTeamMember, removeTeamMember } from './actions'

interface TeamMember {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  role: string
  created_at: string
}

interface TeamMembersListProps {
  members: TeamMember[]
  currentUserId: string
  currentUserRole: string
  tenantId: string
}

const ROLE_LABELS = {
  owner: { label: 'Owner', icon: Shield, color: 'text-primary' },
  admin: { label: 'Admin', icon: Shield, color: 'text-blue-600' },
  editor: { label: 'Editor', icon: Edit2, color: 'text-green-600' },
  viewer: { label: 'Viewer', icon: User, color: 'text-gray-600' }
}

export function TeamMembersList({ members, currentUserId, currentUserRole, tenantId }: TeamMembersListProps) {
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin'
  
  async function handleRoleChange(memberId: string, newRole: string) {
    setSaving(true)
    
    try {
      const formData = new FormData()
      formData.append('tenant_id', tenantId)
      formData.append('member_id', memberId)
      formData.append('role', newRole)
      
      const result = await updateTeamMember(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Team member role updated')
        setEditingMember(null)
      }
    } catch (error) {
      toast.error('Failed to update team member')
    } finally {
      setSaving(false)
    }
  }
  
  async function handleRemove(memberId: string) {
    if (!confirm('Are you sure you want to remove this team member?')) {
      return
    }
    
    setSaving(true)
    
    try {
      const formData = new FormData()
      formData.append('tenant_id', tenantId)
      formData.append('member_id', memberId)
      
      const result = await removeTeamMember(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Team member removed')
      }
    } catch (error) {
      toast.error('Failed to remove team member')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <div className="space-y-3">
      {members.map((member) => {
        const roleConfig = ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] || ROLE_LABELS.viewer
        const RoleIcon = roleConfig.icon
        const isCurrentUser = member.id === currentUserId
        const isOwner = member.role === 'owner'
        const isEditing = editingMember === member.id
        
        return (
          <div key={member.id} className="flex items-center justify-between p-4 bg-surface rounded-medium border border-border">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center ${roleConfig.color}`}>
                <RoleIcon className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium">
                  {member.first_name || member.last_name 
                    ? `${member.first_name || ''} ${member.last_name || ''}`.trim()
                    : member.email}
                  {isCurrentUser && <span className="text-text-secondary ml-2">(You)</span>}
                </p>
                <p className="text-sm text-text-secondary">{member.email}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {isEditing ? (
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value)}
                  disabled={saving}
                  className="px-3 py-1 border border-border rounded-medium text-sm"
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className={`px-3 py-1 bg-white border border-border rounded-full text-sm font-medium ${roleConfig.color}`}>
                  {roleConfig.label}
                </span>
              )}
              
              {canManage && !isOwner && !isCurrentUser && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingMember(isEditing ? null : member.id)}
                    disabled={saving}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    title="Edit role"
                  >
                    <Edit2 className="w-4 h-4 text-text-secondary" />
                  </button>
                  <button
                    onClick={() => handleRemove(member.id)}
                    disabled={saving}
                    className="p-1 hover:bg-red-50 rounded transition-colors"
                    title="Remove member"
                  >
                    <Trash2 className="w-4 h-4 text-error" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
      
      {members.length === 0 && (
        <p className="text-text-secondary text-center py-8">
          No team members yet. Invite your first team member above.
        </p>
      )}
    </div>
  )
}