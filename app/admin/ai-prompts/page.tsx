"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Shield, Plus, Edit2, Save, X, Trash2, History, RotateCcw,
  Search, Filter, Eye, EyeOff, Star, StarOff,
  Facebook, Instagram, Twitter, MapPin, Globe
} from "lucide-react";
import Link from "next/link";
import Logo from "@/components/ui/logo";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface AIPlatformPrompt {
  id: string;
  name: string;
  description?: string;
  platform: string;
  content_type: string;
  system_prompt: string;
  user_prompt_template: string;
  version: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface PromptHistory {
  id: string;
  version: number;
  system_prompt: string;
  user_prompt_template: string;
  change_description?: string;
  created_at: string;
  created_by_user?: { email: string };
}

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook', icon: Facebook },
  { value: 'instagram', label: 'Instagram', icon: Instagram },
  { value: 'twitter', label: 'Twitter/X', icon: Twitter },
  { value: 'google_my_business', label: 'Google My Business', icon: MapPin },
  { value: 'general', label: 'General', icon: Globe },
];

const CONTENT_TYPES = [
  { value: 'post', label: 'Post' },
  { value: 'story', label: 'Story' },
  { value: 'reel', label: 'Reel' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'event', label: 'Event' },
  { value: 'offer', label: 'Offer' },
];

export default function AIPromptsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [prompts, setPrompts] = useState<AIPlatformPrompt[]>([]);
  const [filteredPrompts, setFilteredPrompts] = useState<AIPlatformPrompt[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<PromptHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    platform: 'facebook',
    content_type: 'post',
    system_prompt: '',
    user_prompt_template: '',
    is_active: true,
    is_default: false
  });

  useEffect(() => {
    checkAuthorization();
  }, []);

  useEffect(() => {
    filterPrompts();
  }, [prompts, searchTerm, platformFilter, contentTypeFilter]);

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
    await fetchPrompts();
  };

  const fetchPrompts = async () => {
    try {
      const response = await fetch('/api/admin/ai-prompts');
      if (!response.ok) throw new Error('Failed to fetch prompts');
      const data = await response.json();
      setPrompts(data);
    } catch (error) {
      console.error("Error fetching prompts:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterPrompts = () => {
    let filtered = prompts;

    if (searchTerm) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.system_prompt.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (platformFilter !== 'all') {
      filtered = filtered.filter(p => p.platform === platformFilter);
    }

    if (contentTypeFilter !== 'all') {
      filtered = filtered.filter(p => p.content_type === contentTypeFilter);
    }

    setFilteredPrompts(filtered);
  };

  const handleSave = async () => {
    try {
      const url = editingId ? '/api/admin/ai-prompts' : '/api/admin/ai-prompts';
      const method = editingId ? 'PUT' : 'POST';
      
      const payload = editingId 
        ? { id: editingId, ...editForm }
        : editForm;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Failed to save prompt');

      setEditingId(null);
      setShowAddForm(false);
      setEditForm({
        name: '',
        description: '',
        platform: 'facebook',
        content_type: 'post',
        system_prompt: '',
        user_prompt_template: '',
        is_active: true,
        is_default: false
      });
      
      await fetchPrompts();
    } catch (error) {
      console.error("Error saving prompt:", error);
      alert("Failed to save prompt");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this AI prompt?")) return;

    try {
      const response = await fetch(`/api/admin/ai-prompts?id=${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete prompt');
      await fetchPrompts();
    } catch (error) {
      console.error("Error deleting prompt:", error);
      alert("Failed to delete prompt");
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch('/api/admin/ai-prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id, 
          is_active: !currentStatus 
        })
      });

      if (!response.ok) throw new Error('Failed to toggle status');
      await fetchPrompts();
    } catch (error) {
      console.error("Error toggling status:", error);
      alert("Failed to update status");
    }
  };

  const handleToggleDefault = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch('/api/admin/ai-prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id, 
          is_default: !currentStatus 
        })
      });

      if (!response.ok) throw new Error('Failed to toggle default');
      await fetchPrompts();
    } catch (error) {
      console.error("Error toggling default:", error);
      alert("Failed to update default status");
    }
  };

  const fetchHistory = async (promptId: string) => {
    setLoadingHistory(true);
    try {
      const response = await fetch(`/api/admin/ai-prompts/history?promptId=${promptId}`);
      if (!response.ok) throw new Error('Failed to fetch history');
      const data = await response.json();
      setHistory(data);
      setShowHistory(promptId);
    } catch (error) {
      console.error("Error fetching history:", error);
      alert("Failed to fetch version history");
    } finally {
      setLoadingHistory(false);
    }
  };

  const restoreVersion = async (promptId: string, version: number) => {
    if (!confirm(`Are you sure you want to restore to version ${version}?`)) return;

    try {
      const response = await fetch('/api/admin/ai-prompts/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          promptId, 
          version,
          changeDescription: `Restored to version ${version} by admin`
        })
      });

      if (!response.ok) throw new Error('Failed to restore version');
      
      setShowHistory(null);
      await fetchPrompts();
      alert('Version restored successfully');
    } catch (error) {
      console.error("Error restoring version:", error);
      alert("Failed to restore version");
    }
  };

  const startEdit = (prompt: AIPlatformPrompt) => {
    setEditingId(prompt.id);
    setEditForm({
      name: prompt.name,
      description: prompt.description || '',
      platform: prompt.platform,
      content_type: prompt.content_type,
      system_prompt: prompt.system_prompt,
      user_prompt_template: prompt.user_prompt_template,
      is_active: prompt.is_active,
      is_default: prompt.is_default
    });
  };

  const getPlatformIcon = (platform: string) => {
    const platformObj = PLATFORMS.find(p => p.value === platform);
    return platformObj?.icon || Globe;
  };

  const getPlatformLabel = (platform: string) => {
    const platformObj = PLATFORMS.find(p => p.value === platform);
    return platformObj?.label || platform;
  };

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
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo />
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-warning" />
                <span className="text-sm font-medium text-warning">SUPERADMIN</span>
              </div>
            </div>
            {/* Navigation removed; SubNav in layout provides section navigation */}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-heading font-bold mb-2">AI Platform Prompts</h1>
          <p className="text-text-secondary">Manage platform-specific AI prompts for content generation</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{prompts.length}</p>
                <p className="text-sm text-text-secondary">Total Prompts</p>
              </div>
              <Shield className="w-8 h-8 text-primary" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {prompts.filter(p => p.is_active).length}
                </p>
                <p className="text-sm text-text-secondary">Active</p>
              </div>
              <Eye className="w-8 h-8 text-success" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {prompts.filter(p => p.is_default).length}
                </p>
                <p className="text-sm text-text-secondary">Defaults</p>
              </div>
              <Star className="w-8 h-8 text-warning" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {new Set(prompts.map(p => p.platform)).size}
                </p>
                <p className="text-sm text-text-secondary">Platforms</p>
              </div>
              <Globe className="w-8 h-8 text-info" />
            </div>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <Input
                placeholder="Search prompts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 w-64"
              />
            </div>
            <Select
              value={platformFilter}
              onChange={(e) => setPlatformFilter((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All Platforms</option>
              {PLATFORMS.map(platform => (
                <option key={platform.value} value={platform.value}>
                  {platform.label}
                </option>
              ))}
            </Select>
            <Select
              value={contentTypeFilter}
              onChange={(e) => setContentTypeFilter((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All Content Types</option>
              {CONTENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Prompt
          </Button>
        </div>

        {/* Add/Edit Form */}
        {(showAddForm || editingId) && (
          <Card className="mb-6 border-primary p-6">
            <h3 className="font-medium mb-4">
              {editingId ? 'Edit AI Prompt' : 'Add AI Prompt'}
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Enter prompt name..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Describe this prompt..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Platform</label>
                <Select
                  value={editForm.platform}
                  onChange={(e) => setEditForm({ ...editForm, platform: (e.target as HTMLSelectElement).value })}
                  disabled={!!editingId}
                >
                  {PLATFORMS.map(platform => (
                    <option key={platform.value} value={platform.value}>
                      {platform.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Content Type</label>
                <Select
                  value={editForm.content_type}
                  onChange={(e) => setEditForm({ ...editForm, content_type: (e.target as HTMLSelectElement).value })}
                  disabled={!!editingId}
                >
                  {CONTENT_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium mb-2">System Prompt</label>
                <Textarea
                  value={editForm.system_prompt}
                  onChange={(e) => setEditForm({ ...editForm, system_prompt: e.target.value })}
                  placeholder="Enter the system prompt for AI..."
                  className="h-32 resize-y"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium mb-2">User Prompt Template</label>
                <Textarea
                  value={editForm.user_prompt_template}
                  onChange={(e) => setEditForm({ ...editForm, user_prompt_template: e.target.value })}
                  placeholder="Enter the user prompt template with placeholders..."
                  className="h-24 resize-y"
                />
                <p className="text-xs text-text-secondary mt-1">
                  Use placeholders like {'{campaignType}'}, {'{businessName}'}, {'{eventDate}'}, etc.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: (e.target as HTMLInputElement).checked })}
                  />
                  <span className="text-sm">Active</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={editForm.is_default}
                    onChange={(e) => setEditForm({ ...editForm, is_default: (e.target as HTMLInputElement).checked })}
                  />
                  <span className="text-sm">Default for platform/type</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                onClick={handleSave}
                disabled={!editForm.name || !editForm.system_prompt || !editForm.user_prompt_template}
              >
                <Save className="w-4 h-4 mr-2" />
                Save Prompt
              </Button>
              <Button
                onClick={() => {
                  setEditingId(null);
                  setShowAddForm(false);
                  setEditForm({
                    name: '',
                    description: '',
                    platform: 'facebook',
                    content_type: 'post',
                    system_prompt: '',
                    user_prompt_template: '',
                    is_active: true,
                    is_default: false
                  });
                }}
                variant="secondary"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* History Modal */}
        {showHistory && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-large w-full max-w-4xl max-h-[90vh] overflow-hidden">
              <div className="p-6 border-b border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">Version History</h3>
                  <button
                    onClick={() => setShowHistory(null)}
                    className="p-2 hover:bg-background rounded-medium"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh]">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {history.map((entry) => (
                      <div key={entry.id} className="border border-border rounded-medium p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="badge-info">Version {entry.version}</span>
                            <span className="text-sm text-text-secondary">
                              {new Date(entry.created_at).toLocaleDateString('en-GB')} at{' '}
                              {new Date(entry.created_at).toLocaleTimeString('en-GB')}
                            </span>
                            {entry.created_by_user && (
                              <span className="text-sm text-text-secondary">
                                by {entry.created_by_user.email}
                              </span>
                            )}
                          </div>
                          <Button
                            onClick={() => restoreVersion(showHistory, entry.version)}
                            variant="secondary"
                            size="sm"
                            title="Restore this version"
                          >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            Restore
                          </Button>
                        </div>
                        {entry.change_description && (
                          <p className="text-sm text-text-secondary mb-3">
                            {entry.change_description}
                          </p>
                        )}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                          <div>
                            <h5 className="font-medium mb-2">System Prompt:</h5>
                            <div className="bg-background p-3 rounded border max-h-32 overflow-y-auto">
                              {entry.system_prompt}
                            </div>
                          </div>
                          <div>
                            <h5 className="font-medium mb-2">User Prompt Template:</h5>
                            <div className="bg-background p-3 rounded border max-h-32 overflow-y-auto">
                              {entry.user_prompt_template}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Prompts List */}
        <div className="space-y-4">
          {filteredPrompts.map((prompt) => {
            const PlatformIcon = getPlatformIcon(prompt.platform);
            
            return (
              <Card key={prompt.id} className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <PlatformIcon className="w-4 h-4" />
                        <span className="badge-info">
                          {getPlatformLabel(prompt.platform)}
                        </span>
                      </div>
                      <span className="badge-secondary capitalize">
                        {prompt.content_type}
                      </span>
                      <span className={`badge-${prompt.is_active ? 'success' : 'secondary'}`}>
                        {prompt.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {prompt.is_default && (
                        <span className="badge-warning flex items-center gap-1">
                          <Star className="w-3 h-3" />
                          Default
                        </span>
                      )}
                      <span className="text-xs text-text-secondary">
                        v{prompt.version}
                      </span>
                    </div>
                    
                    <h3 className="font-medium text-lg mb-2">{prompt.name}</h3>
                    {prompt.description && (
                      <p className="text-text-secondary mb-3">{prompt.description}</p>
                    )}
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-3">
                      <div>
                        <h5 className="font-medium text-sm mb-1">System Prompt:</h5>
                        <div className="bg-background p-3 rounded border text-sm max-h-24 overflow-y-auto">
                          {prompt.system_prompt}
                        </div>
                      </div>
                      <div>
                        <h5 className="font-medium text-sm mb-1">User Prompt Template:</h5>
                        <div className="bg-background p-3 rounded border text-sm max-h-24 overflow-y-auto">
                          {prompt.user_prompt_template}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      <span>Created: {new Date(prompt.created_at).toLocaleDateString('en-GB')}</span>
                      <span>•</span>
                      <span>Updated: {new Date(prompt.updated_at).toLocaleDateString('en-GB')}</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(prompt.id, prompt.is_active)}
                      className="p-2 hover:bg-background rounded-medium"
                      title={prompt.is_active ? "Deactivate" : "Activate"}
                    >
                      {prompt.is_active ? (
                        <EyeOff className="w-4 h-4 text-warning" />
                      ) : (
                        <Eye className="w-4 h-4 text-success" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => handleToggleDefault(prompt.id, prompt.is_default)}
                      className="p-2 hover:bg-background rounded-medium"
                      title={prompt.is_default ? "Remove as default" : "Set as default"}
                    >
                      {prompt.is_default ? (
                        <StarOff className="w-4 h-4 text-warning" />
                      ) : (
                        <Star className="w-4 h-4 text-text-secondary" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => fetchHistory(prompt.id)}
                      className="p-2 hover:bg-background rounded-medium"
                      title="View version history"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={() => startEdit(prompt)}
                      className="p-2 hover:bg-background rounded-medium"
                      title="Edit prompt"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={() => handleDelete(prompt.id)}
                      className="p-2 hover:bg-background rounded-medium"
                      title="Delete prompt"
                    >
                      <Trash2 className="w-4 h-4 text-error" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {filteredPrompts.length === 0 && (
          <div className="text-center py-12 text-text-secondary">
            <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No AI prompts found matching your criteria</p>
            {(searchTerm || platformFilter !== 'all' || contentTypeFilter !== 'all') && (
              <Button
                onClick={() => {
                  setSearchTerm('');
                  setPlatformFilter('all');
                  setContentTypeFilter('all');
                }}
                variant="secondary"
                className="mt-4"
              >
                Clear Filters
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
