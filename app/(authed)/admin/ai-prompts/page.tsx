"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Shield, Plus, Edit2, Save, X, Trash2, History, RotateCcw,
  Search, Eye, EyeOff, Star, StarOff,
  Facebook, Instagram, MapPin, Globe
} from "lucide-react";
import { toast } from 'sonner';
import { Card } from "@/components/ui/card";
import Container from "@/components/layout/container";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatTime } from "@/lib/datetime";
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
  { value: 'google_my_business', label: 'Google Business Profile', icon: MapPin },
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
  const [pageError, setPageError] = useState<string | null>(null);

  // Preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCampaignId, setPreviewCampaignId] = useState("");
  const [previewPlatform, setPreviewPlatform] = useState<string>("facebook");
  const [previewResult, setPreviewResult] = useState<{ system: string; user: string } | null>(null);

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

  const checkAuthorization = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin, email")
      .eq("id", user.id)
      .single();

    const emailOk = ((userData?.email || user.email || '').toLowerCase() === 'peter.pitcher@outlook.com');
    if (!userData?.is_superadmin && !emailOk) {
      router.push("/dashboard");
      return;
    }

    setIsAuthorized(true);
    await fetchPrompts();
  }, [router]);

  const fetchPrompts = async () => {
    try {
      const response = await fetch('/api/admin/ai-prompts');
      if (!response.ok) throw new Error('Failed to fetch prompts');
      const json = await response.json();
      setPrompts(json?.data ?? json ?? []);
    } catch (error) {
      console.error("Error fetching prompts:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterPrompts = useCallback(() => {
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
  }, [prompts, searchTerm, platformFilter, contentTypeFilter]);

  useEffect(() => {
    checkAuthorization();
  }, [checkAuthorization]);

  useEffect(() => {
    filterPrompts();
  }, [filterPrompts]);

  // (legacy checkAuthorization removed; replaced by useCallback version above)

  const handleSave = async () => {
    setPageError(null);
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
      toast.success(editingId ? 'Prompt updated' : 'Prompt created');
    } catch (error) {
      console.error("Error saving prompt:", error);
      setPageError("Failed to save prompt");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this AI prompt?")) return;

    try {
      setPageError(null);
      const response = await fetch(`/api/admin/ai-prompts?id=${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete prompt');
      await fetchPrompts();
      toast.success('Prompt deleted');
    } catch (error) {
      console.error("Error deleting prompt:", error);
      setPageError("Failed to delete prompt");
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      setPageError(null);
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
      setPageError("Failed to update status");
    }
  };

  const handleToggleDefault = async (id: string, currentStatus: boolean) => {
    try {
      setPageError(null);
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
      setPageError("Failed to update default status");
    }
  };

  const fetchHistory = async (promptId: string) => {
    setLoadingHistory(true);
    try {
      setPageError(null);
      const response = await fetch(`/api/admin/ai-prompts/history?promptId=${promptId}`);
      if (!response.ok) throw new Error('Failed to fetch history');
      const json = await response.json();
      setHistory(json?.data ?? json ?? []);
      setShowHistory(promptId);
    } catch (error) {
      console.error("Error fetching history:", error);
      setPageError("Failed to fetch version history");
    } finally {
      setLoadingHistory(false);
    }
  };

  const restoreVersion = async (promptId: string, version: number) => {
    if (!confirm(`Are you sure you want to restore to version ${version}?`)) return;

    try {
      setPageError(null);
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
      toast.success('Version restored successfully');
    } catch (error) {
      console.error("Error restoring version:", error);
      setPageError("Failed to restore version");
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

  // Render a simple preview of the effective prompts using current edit form as base.
  const handlePreview = async () => {
    try {
      setPageError(null);
      // For now, just reflect the current form values.
      setPreviewResult({
        system: editForm.system_prompt || "",
        user: editForm.user_prompt_template || "",
      });
    } catch {
      setPageError("Failed to render preview");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-12 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="pb-page-pb pt-page-pt">
        <div className="mb-8">
          <h1 className="mb-2 font-heading text-3xl font-bold">AI Platform Prompts</h1>
          <p className="text-text-secondary">Manage platform-specific AI prompts for content generation</p>
        </div>
        {pageError && (
          <div className="mb-6 rounded-card border border-destructive/30 bg-destructive/10 p-3 text-destructive">
            {pageError}
          </div>
        )}

        {/* Stats */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{prompts.length}</p>
                <p className="text-sm text-text-secondary">Total Prompts</p>
              </div>
              <Shield className="size-8 text-primary" />
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
              <Eye className="size-8 text-success" />
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
              <Star className="size-8 text-warning" />
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
              <Globe className="size-8 text-primary" />
            </div>
          </Card>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
              <Input
                placeholder="Search prompts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64 pl-10"
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setPreviewOpen(true); setPageError(null); }}>
              <Eye className="mr-2 size-4" /> Preview Prompt
            </Button>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="mr-2 size-4" />
              Add Prompt
            </Button>
          </div>
        </div>

        {/* Add/Edit Form */}
        {(showAddForm || editingId) && (
          <Card className="mb-6 border-primary p-6">
            <h3 className="mb-4 font-medium">
              {editingId ? 'Edit AI Prompt' : 'Add AI Prompt'}
            </h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label htmlFor="prompt-name" className="mb-2 block text-sm font-medium">Name</label>
                <Input
                  id="prompt-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Enter prompt name..."
                />
              </div>
              <div>
                <label htmlFor="prompt-description" className="mb-2 block text-sm font-medium">Description</label>
                <Input
                  id="prompt-description"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Describe this prompt..."
                />
              </div>
              <div>
                <label htmlFor="prompt-platform" className="mb-2 block text-sm font-medium">Platform</label>
                <Select
                  id="prompt-platform"
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
                <label htmlFor="prompt-content-type" className="mb-2 block text-sm font-medium">Content Type</label>
                <Select
                  id="prompt-content-type"
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
                <label htmlFor="prompt-system" className="mb-2 block text-sm font-medium">System Prompt</label>
                <Textarea
                  id="prompt-system"
                  value={editForm.system_prompt}
                  onChange={(e) => setEditForm({ ...editForm, system_prompt: e.target.value })}
                  placeholder="Enter the system prompt for AI..."
                  className="h-32 resize-y"
                />
              </div>
              <div className="lg:col-span-2">
                <label htmlFor="prompt-user" className="mb-2 block text-sm font-medium">User Prompt Template</label>
                <Textarea
                  id="prompt-user"
                  value={editForm.user_prompt_template}
                  onChange={(e) => setEditForm({ ...editForm, user_prompt_template: e.target.value })}
                  placeholder="Enter the user prompt template with placeholders..."
                  className="h-24 resize-y"
                />
                <p className="mt-1 text-xs text-text-secondary">
                  Use placeholders like {'{campaignType}'}, {'{businessName}'}, {'{eventDate}'}, etc.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label htmlFor="prompt-active" className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    id="prompt-active"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: (e.target as HTMLInputElement).checked })}
                  />
                  <span className="text-sm">Active</span>
                </label>
                <label htmlFor="prompt-default" className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    id="prompt-default"
                    checked={editForm.is_default}
                    onChange={(e) => setEditForm({ ...editForm, is_default: (e.target as HTMLInputElement).checked })}
                  />
                  <span className="text-sm">Default for platform/type</span>
                </label>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={handleSave}
                disabled={!editForm.name || !editForm.system_prompt || !editForm.user_prompt_template}
              >
                <Save className="mr-2 size-4" />
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
                <X className="mr-2 size-4" />
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* History Modal */}
        {showHistory && (
          <Dialog open={!!showHistory} onOpenChange={(o)=>{ if(!o) setShowHistory(null); }}>
            <DialogContent className="max-w-4xl overflow-hidden p-0">
              <DialogHeader className="border-b border-border p-6">
                <DialogTitle>Version History</DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto p-6">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="size-8 animate-spin rounded-full border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {history.map((entry) => (
                      <div key={entry.id} className="rounded-chip border border-border p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="badge bg-primary/10 text-primary">Version {entry.version}</span>
                            <span className="text-sm text-text-secondary">
                              {formatDate(entry.created_at)} at {formatTime(entry.created_at)}
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
                            <RotateCcw className="mr-1 size-3" />
                            Restore
                          </Button>
                        </div>
                        {entry.change_description && (
                          <p className="mb-3 text-sm text-text-secondary">
                            {entry.change_description}
                          </p>
                        )}
                        <div className="grid grid-cols-1 gap-4 text-sm lg:grid-cols-2">
                          <div>
                            <h5 className="mb-2 font-medium">System Prompt:</h5>
                            <div className="max-h-32 overflow-y-auto rounded border bg-background p-3">
                              {entry.system_prompt}
                            </div>
                          </div>
                          <div>
                            <h5 className="mb-2 font-medium">User Prompt Template:</h5>
                            <div className="max-h-32 overflow-y-auto rounded border bg-background p-3">
                              {entry.user_prompt_template}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Prompts List */}
        <div className="space-y-4">
          {filteredPrompts.map((prompt) => {
            const PlatformIcon = getPlatformIcon(prompt.platform);
            
            return (
              <Card key={prompt.id} className="p-4">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <PlatformIcon className="size-4" />
                        <Badge className="bg-primary/10 text-primary">
                          {getPlatformLabel(prompt.platform)}
                        </Badge>
                      </div>
                      <Badge variant="secondary" className="capitalize">
                        {prompt.content_type}
                      </Badge>
                      <Badge
                        className={prompt.is_active ? 'bg-success/10 text-success' : 'bg-secondary/10 text-secondary-foreground'}
                      >
                        {prompt.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {prompt.is_default && (
                        <Badge className="flex items-center gap-1 bg-warning/10 text-warning">
                          <Star className="size-3" />
                          Default
                        </Badge>
                      )}
                      <span className="text-xs text-text-secondary">
                        v{prompt.version}
                      </span>
                    </div>
                    
                    <h3 className="mb-2 text-lg font-medium">{prompt.name}</h3>
                    {prompt.description && (
                      <p className="mb-3 text-text-secondary">{prompt.description}</p>
                    )}
                    
                    <div className="mb-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <h5 className="mb-1 text-sm font-medium">System Prompt:</h5>
                        <div className="max-h-24 overflow-y-auto rounded border bg-background p-3 text-sm">
                          {prompt.system_prompt}
                        </div>
                      </div>
                      <div>
                        <h5 className="mb-1 text-sm font-medium">User Prompt Template:</h5>
                        <div className="max-h-24 overflow-y-auto rounded border bg-background p-3 text-sm">
                          {prompt.user_prompt_template}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      <span>Created: {formatDate(prompt.created_at)}</span>
                      <span>•</span>
                      <span>Updated: {formatDate(prompt.updated_at)}</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(prompt.id, prompt.is_active)}
                      className="rounded-chip p-2 hover:bg-background"
                      title={prompt.is_active ? "Deactivate" : "Activate"}
                    >
                      {prompt.is_active ? (
                        <EyeOff className="size-4 text-warning" />
                      ) : (
                        <Eye className="size-4 text-success" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => handleToggleDefault(prompt.id, prompt.is_default)}
                      className="rounded-chip p-2 hover:bg-background"
                      title={prompt.is_default ? "Remove as default" : "Set as default"}
                    >
                      {prompt.is_default ? (
                        <StarOff className="size-4 text-warning" />
                      ) : (
                        <Star className="size-4 text-text-secondary" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => fetchHistory(prompt.id)}
                      className="rounded-chip p-2 hover:bg-background"
                      title="View version history"
                    >
                      <History className="size-4" />
                    </button>
                    
                    <button
                      onClick={() => startEdit(prompt)}
                      className="rounded-chip p-2 hover:bg-background"
                      title="Edit prompt"
                    >
                      <Edit2 className="size-4" />
                    </button>
                    
                    <button
                      onClick={() => handleDelete(prompt.id)}
                      className="rounded-chip p-2 hover:bg-background"
                      title="Delete prompt"
                    >
                      <Trash2 className="size-4 text-error" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {filteredPrompts.length === 0 && (
          <div className="py-12 text-center text-text-secondary">
            <Shield className="mx-auto mb-4 size-12 opacity-50" />
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
      </Container>

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Preview Effective Prompt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label" htmlFor="preview-campaign-id">Campaign ID</label>
                <Input
                  id="preview-campaign-id"
                  value={previewCampaignId}
                  onChange={(e)=>setPreviewCampaignId(e.target.value)}
                  placeholder="e.g., a4021927-..."
                />
              </div>
              <div>
                <label className="label" htmlFor="preview-platform">Platform</label>
                <select
                  id="preview-platform"
                  className="w-full rounded-md border border-input px-3 py-2"
                  value={previewPlatform}
                  onChange={(e)=>setPreviewPlatform(e.target.value)}
                >
                  {PLATFORMS.filter(p=>p.value!=='general').map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handlePreview}><Eye className="mr-2 size-4" /> Render</Button>
            </div>
            {previewResult && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 font-semibold">System Prompt</h3>
                  <Textarea readOnly value={previewResult.system} className="min-h-[160px]" />
                </div>
                <div>
                  <h3 className="mb-1 font-semibold">User Prompt</h3>
                  <Textarea readOnly value={previewResult.user} className="min-h-[160px]" />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      </main>
    </div>
  );
}
