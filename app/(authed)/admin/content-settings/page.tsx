"use client";

import { useState, useEffect, useCallback, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Shield, Plus, Trash2, Edit2, Save, X,
  AlertCircle, CheckCircle, Search
} from "lucide-react";
import Container from "@/components/layout/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/datetime";

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

  const fetchGuardrails = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    const checkAuthorization = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/");
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

    void checkAuthorization();
  }, [fetchGuardrails, router]);

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

  const handleFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFilterType(event.target.value);
  };

  const handleRuleTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setNewGuardrail({
      ...newGuardrail,
      rule_type: event.target.value as GlobalGuardrail['rule_type'],
    });
  };

  const filteredGuardrails = guardrails.filter(g => {
    const matchesSearch = g.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          g.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || g.rule_type === filterType;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-12 animate-spin rounded-full border-b-2 border-primary" aria-hidden>
        </div>
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="flex items-center gap-2">
                <Shield className="size-4" />
                Superadmin
              </Badge>
            </div>
            {/* Navigation removed; SubNav in layout provides section navigation */}
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-4">
        <div className="mb-8">
          <h1 className="mb-2 font-heading text-3xl font-bold">Global Content Settings</h1>
          <p className="text-text-secondary">Manage system-wide content guardrails that apply to all tenants</p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{guardrails.length}</p>
                <p className="text-sm text-text-secondary">Total Rules</p>
              </div>
              <Shield className="size-8 text-primary" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {guardrails.filter(g => g.rule_type === 'avoid').length}
                </p>
                <p className="text-sm text-text-secondary">Avoid Rules</p>
              </div>
              <AlertCircle className="size-8 text-error" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {guardrails.filter(g => g.rule_type === 'enforce').length}
                </p>
                <p className="text-sm text-text-secondary">Enforce Rules</p>
              </div>
              <CheckCircle className="size-8 text-success" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {guardrails.filter(g => g.is_active).length}
                </p>
                <p className="text-sm text-text-secondary">Active Rules</p>
              </div>
              <CheckCircle className="size-8 text-success" />
            </div>
          </Card>
        </div>

        {/* Controls */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
              <Input
                placeholder="Search guardrails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64 pl-10"
              />
            </div>
            <Select value={filterType} onChange={handleFilterChange} aria-label="Filter guardrails">
              <option value="all">All Types</option>
              <option value="avoid">Avoid</option>
              <option value="enforce">Enforce</option>
              <option value="style">Style</option>
            </Select>
          </div>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="mr-2 size-4" />
            Add Guardrail
          </Button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <Card className="mb-6 border-primary p-6">
            <h3 className="mb-4 font-medium">Add Global Guardrail</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="new-guardrail-type">Type</label>
                <Select
                  id="new-guardrail-type"
                  value={newGuardrail.rule_type}
                  onChange={handleRuleTypeChange}
                >
                  <option value="avoid">Avoid</option>
                  <option value="enforce">Enforce</option>
                  <option value="style">Style</option>
                </Select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="new-guardrail-content">Content</label>
                <Input
                  id="new-guardrail-content"
                  value={newGuardrail.content}
                  onChange={(e) => setNewGuardrail({ ...newGuardrail, content: e.target.value })}
                  placeholder="Enter the rule content..."
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="new-guardrail-description">Description (optional)</label>
                <Input
                  id="new-guardrail-description"
                  value={newGuardrail.description}
                  onChange={(e) => setNewGuardrail({ ...newGuardrail, description: e.target.value })}
                  placeholder="Describe the purpose of this rule..."
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddGuardrail} disabled={!newGuardrail.content}>
                  <Save className="mr-2 size-4" />
                  Save Guardrail
                </Button>
                <Button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewGuardrail({ rule_type: 'avoid', content: '', description: '' });
                  }}
                  variant="secondary"
                >
                  <X className="mr-2 size-4" />
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Guardrails List */}
        <div className="space-y-4">
          {filteredGuardrails.map((guardrail) => (
            <Card key={guardrail.id} className="p-4">
              {editingId === guardrail.id ? (
                <div className="space-y-4">
                  <Input
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  <Input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <div className="flex gap-2">
                    <Button onClick={() => handleUpdateGuardrail(guardrail.id)}>
                      <Save className="mr-2 size-4" />
                      Save
                    </Button>
                    <Button onClick={() => setEditingId(null)} variant="secondary">
                      <X className="mr-2 size-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <Badge className={
                        guardrail.rule_type === 'avoid'
                          ? 'bg-destructive/10 text-destructive'
                          : guardrail.rule_type === 'enforce'
                            ? 'bg-success/10 text-success'
                            : 'bg-secondary/10 text-secondary-foreground'
                      }>
                        {guardrail.rule_type}
                      </Badge>
                      <Badge className={guardrail.is_active ? 'bg-success/10 text-success' : 'bg-secondary/10 text-secondary-foreground'}>
                        {guardrail.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="mb-1 font-medium">{guardrail.content}</p>
                    {guardrail.description && (
                      <p className="text-sm text-text-secondary">{guardrail.description}</p>
                    )}
                    <p className="mt-2 text-xs text-text-secondary">
                      Created: {formatDate(guardrail.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggleActive(guardrail.id, guardrail.is_active)}
                      aria-label={guardrail.is_active ? 'Deactivate guardrail' : 'Activate guardrail'}
                    >
                      {guardrail.is_active ? (
                        <X className="size-4 text-warning" />
                      ) : (
                        <CheckCircle className="size-4 text-success" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingId(guardrail.id);
                        setEditContent(guardrail.content);
                        setEditDescription(guardrail.description || '');
                      }}
                      aria-label="Edit guardrail"
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteGuardrail(guardrail.id)}
                      aria-label="Delete guardrail"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>

        {filteredGuardrails.length === 0 && (
          <div className="py-12 text-center text-text-secondary">
            <Shield className="mx-auto mb-4 size-12 opacity-50" />
            <p>No guardrails found</p>
          </div>
        )}
        </Container>
      </main>
    </div>
  );
}
