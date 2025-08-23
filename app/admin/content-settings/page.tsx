"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Shield, Plus, Trash2, Edit2, Save, X,
  AlertCircle, CheckCircle, Search, Filter
} from "lucide-react";
import Link from "next/link";
import Logo from "@/components/ui/logo";

interface GlobalGuardrail {
  id: string;
  rule_type: 'avoid' | 'enforce' | 'style';
  content: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function ContentSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [guardrails, setGuardrails] = useState<GlobalGuardrail[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newGuardrail, setNewGuardrail] = useState({
    rule_type: 'avoid' as const,
    content: '',
    description: ''
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    checkAuthorization();
  }, []);

  const checkAuthorization = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      router.push("/dashboard");
      return;
    }

    setIsAuthorized(true);
    await fetchGuardrails();
  };

  const fetchGuardrails = async () => {
    const supabase = createClient();
    
    try {
      // Fetch global guardrails (ones without tenant_id)
      const { data, error } = await supabase
        .from("guardrails")
        .select("*")
        .is("tenant_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGuardrails(data || []);
    } catch (error) {
      console.error("Error fetching guardrails:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddGuardrail = async () => {
    const supabase = createClient();
    
    try {
      const { error } = await supabase
        .from("guardrails")
        .insert({
          rule_type: newGuardrail.rule_type,
          content: newGuardrail.content,
          description: newGuardrail.description || null,
          is_active: true,
          tenant_id: null // Global guardrail
        });

      if (error) throw error;

      setShowAddForm(false);
      setNewGuardrail({ rule_type: 'avoid', content: '', description: '' });
      await fetchGuardrails();
    } catch (error) {
      console.error("Error adding guardrail:", error);
    }
  };

  const handleUpdateGuardrail = async (id: string) => {
    const supabase = createClient();
    
    try {
      const { error } = await supabase
        .from("guardrails")
        .update({
          content: editContent,
          description: editDescription || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;

      setEditingId(null);
      await fetchGuardrails();
    } catch (error) {
      console.error("Error updating guardrail:", error);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    const supabase = createClient();
    
    try {
      const { error } = await supabase
        .from("guardrails")
        .update({
          is_active: !currentStatus,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;
      await fetchGuardrails();
    } catch (error) {
      console.error("Error toggling guardrail:", error);
    }
  };

  const handleDeleteGuardrail = async (id: string) => {
    if (!confirm("Are you sure you want to delete this guardrail?")) return;

    const supabase = createClient();
    
    try {
      const { error } = await supabase
        .from("guardrails")
        .delete()
        .eq("id", id);

      if (error) throw error;
      await fetchGuardrails();
    } catch (error) {
      console.error("Error deleting guardrail:", error);
    }
  };

  const filteredGuardrails = guardrails.filter(g => {
    const matchesSearch = g.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          g.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || g.rule_type === filterType;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo />
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-warning" />
                <span className="text-sm font-medium text-warning">SUPERADMIN</span>
              </div>
            </div>
            <nav className="flex items-center gap-6">
              <Link href="/admin/dashboard" className="text-text-secondary hover:text-primary">
                Dashboard
              </Link>
              <Link href="/admin/tenants" className="text-text-secondary hover:text-primary">
                Tenants
              </Link>
              <Link href="/admin/content-settings" className="text-primary font-medium">
                Content Settings
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-heading font-bold mb-2">Global Content Settings</h1>
          <p className="text-text-secondary">Manage system-wide content guardrails that apply to all tenants</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{guardrails.length}</p>
                <p className="text-sm text-text-secondary">Total Rules</p>
              </div>
              <Shield className="w-8 h-8 text-primary" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {guardrails.filter(g => g.rule_type === 'avoid').length}
                </p>
                <p className="text-sm text-text-secondary">Avoid Rules</p>
              </div>
              <AlertCircle className="w-8 h-8 text-error" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {guardrails.filter(g => g.rule_type === 'enforce').length}
                </p>
                <p className="text-sm text-text-secondary">Enforce Rules</p>
              </div>
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {guardrails.filter(g => g.is_active).length}
                </p>
                <p className="text-sm text-text-secondary">Active Rules</p>
              </div>
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                placeholder="Search guardrails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field pl-10 w-64"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input-field"
            >
              <option value="all">All Types</option>
              <option value="avoid">Avoid</option>
              <option value="enforce">Enforce</option>
              <option value="style">Style</option>
            </select>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Guardrail
          </button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="card mb-6 border-primary">
            <h3 className="font-medium mb-4">Add Global Guardrail</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Type</label>
                <select
                  value={newGuardrail.rule_type}
                  onChange={(e) => setNewGuardrail({ ...newGuardrail, rule_type: e.target.value as any })}
                  className="input-field"
                >
                  <option value="avoid">Avoid</option>
                  <option value="enforce">Enforce</option>
                  <option value="style">Style</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Content</label>
                <input
                  type="text"
                  value={newGuardrail.content}
                  onChange={(e) => setNewGuardrail({ ...newGuardrail, content: e.target.value })}
                  placeholder="Enter the rule content..."
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description (optional)</label>
                <input
                  type="text"
                  value={newGuardrail.description}
                  onChange={(e) => setNewGuardrail({ ...newGuardrail, description: e.target.value })}
                  placeholder="Describe the purpose of this rule..."
                  className="input-field"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddGuardrail}
                  disabled={!newGuardrail.content}
                  className="btn-primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Guardrail
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewGuardrail({ rule_type: 'avoid', content: '', description: '' });
                  }}
                  className="btn-secondary"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Guardrails List */}
        <div className="space-y-4">
          {filteredGuardrails.map((guardrail) => (
            <div key={guardrail.id} className="card">
              {editingId === guardrail.id ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="input-field"
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description"
                    className="input-field"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdateGuardrail(guardrail.id)}
                      className="btn-primary"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="btn-secondary"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`badge-${
                        guardrail.rule_type === 'avoid' ? 'error' :
                        guardrail.rule_type === 'enforce' ? 'success' : 'secondary'
                      }`}>
                        {guardrail.rule_type}
                      </span>
                      <span className={`badge-${guardrail.is_active ? 'success' : 'secondary'}`}>
                        {guardrail.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="font-medium mb-1">{guardrail.content}</p>
                    {guardrail.description && (
                      <p className="text-sm text-text-secondary">{guardrail.description}</p>
                    )}
                    <p className="text-xs text-text-secondary mt-2">
                      Created: {new Date(guardrail.created_at).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(guardrail.id, guardrail.is_active)}
                      className="p-2 hover:bg-background rounded-medium"
                      title={guardrail.is_active ? "Deactivate" : "Activate"}
                    >
                      {guardrail.is_active ? (
                        <X className="w-4 h-4 text-warning" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-success" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(guardrail.id);
                        setEditContent(guardrail.content);
                        setEditDescription(guardrail.description || '');
                      }}
                      className="p-2 hover:bg-background rounded-medium"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteGuardrail(guardrail.id)}
                      className="p-2 hover:bg-background rounded-medium"
                    >
                      <Trash2 className="w-4 h-4 text-error" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {filteredGuardrails.length === 0 && (
          <div className="text-center py-12 text-text-secondary">
            <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No guardrails found</p>
          </div>
        )}
      </main>
    </div>
  );
}