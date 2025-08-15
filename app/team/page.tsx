'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { UserPlus, Mail, Shield, Trash2, Copy, Check } from 'lucide-react';

interface TeamMember {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  status: 'active' | 'invited' | 'disabled';
  joined_at: string;
  invited_at?: string;
}

const roleColors = {
  owner: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
  editor: 'bg-green-100 text-green-800',
  viewer: 'bg-gray-100 text-gray-800',
};

const roleDescriptions = {
  owner: 'Full access and billing control',
  admin: 'Manage team and all content',
  editor: 'Create and edit content',
  viewer: 'View content and analytics',
};

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadTeamMembers();
  }, []);

  const loadTeamMembers = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .order('role', { ascending: true })
      .order('joined_at', { ascending: false });

    if (!error && data) {
      setMembers(data);
    }
    setLoading(false);
  };

  const inviteMember = async () => {
    if (!inviteEmail || !inviteRole) return;

    setInviting(true);
    const response = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });

    const result = await response.json();
    if (result.success) {
      setInviteLink(result.inviteLink);
      setInviteEmail('');
      loadTeamMembers();
    }
    setInviting(false);
  };

  const removeMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this team member?')) return;

    const response = await fetch(`/api/team/remove`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    });

    if (response.ok) {
      loadTeamMembers();
    }
  };

  const updateRole = async (memberId: string, newRole: string) => {
    const response = await fetch('/api/team/update-role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, role: newRole }),
    });

    if (response.ok) {
      loadTeamMembers();
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Team Management</h1>
        <p className="text-gray-600">
          Manage your team members and their permissions
        </p>
      </div>

      {/* Invite Section */}
      <Card className="p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <UserPlus className="mr-2" size={20} />
          Invite Team Members
        </h2>
        
        <div className="flex gap-4">
          <input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as any)}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          
          <Button 
            onClick={inviteMember}
            disabled={inviting || !inviteEmail}
          >
            {inviting ? 'Sending...' : 'Send Invite'}
          </Button>
        </div>

        {inviteLink && (
          <div className="mt-4 p-4 bg-green-50 rounded-lg">
            <p className="text-sm font-semibold text-green-800 mb-2">
              Invitation sent successfully!
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="flex-1 px-3 py-1 text-sm bg-white border rounded"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={copyInviteLink}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Team Members List */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Current Team Members</h2>
        
        {loading ? (
          <div className="text-center py-8 text-gray-500">
            Loading team members...
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No team members yet. Start by inviting someone!
          </div>
        ) : (
          <div className="space-y-4">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <Mail size={16} className="text-gray-600" />
                  </div>
                  
                  <div>
                    <div className="font-medium">{member.email}</div>
                    <div className="text-sm text-gray-500">
                      {member.status === 'invited' 
                        ? `Invited ${new Date(member.invited_at!).toLocaleDateString()}`
                        : `Joined ${new Date(member.joined_at).toLocaleDateString()}`
                      }
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${roleColors[member.role]}`}>
                      {member.role}
                    </span>
                    {member.status === 'invited' && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {member.role !== 'owner' && (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) => updateRole(member.id, e.target.value)}
                        className="px-3 py-1 text-sm border rounded"
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMember(member.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Role Descriptions */}
      <Card className="p-6 mt-8">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Shield className="mr-2" size={20} />
          Role Permissions
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(roleDescriptions).map(([role, description]) => (
            <div key={role} className="flex items-start gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${roleColors[role as keyof typeof roleColors]}`}>
                {role}
              </span>
              <p className="text-sm text-gray-600">{description}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}