"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, Upload, Mic, FileText, Loader2,
  CheckCircle, AlertCircle, Sparkles, Plus, Trash2,
  Shield, Settings, Eye, EyeOff
} from "lucide-react";
import Link from "next/link";

interface VoiceSample {
  id: string;
  content: string;
  type: 'caption' | 'blog' | 'email' | 'menu' | 'custom';
  created_at: string;
}

interface VoiceProfile {
  id: string;
  tenant_id: string;
  tone_attributes: string[];
  vocabulary: string[];
  sentence_patterns: any;
  avg_sentence_length: number;
  emoji_usage: boolean;
  hashtag_style: string;
  trained_at?: string;
  sample_count: number;
}

interface Guardrail {
  id: string;
  context_type: string;
  platform?: string;
  feedback_type: string;
  feedback_text: string;
  is_active: boolean;
  times_applied: number;
  created_at: string;
}

export default function BrandVoicePage() {
  const router = useRouter();
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [newSample, setNewSample] = useState("");
  const [sampleType, setSampleType] = useState<VoiceSample['type']>('caption');
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'samples' | 'guardrails'>('samples');
  const [newGuardrail, setNewGuardrail] = useState("");
  const [guardrailType, setGuardrailType] = useState<'avoid' | 'include' | 'tone' | 'style' | 'format'>('avoid');

  useEffect(() => {
    fetchVoiceData();
  }, []);

  const fetchVoiceData = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Fetch voice samples
    const { data: samplesData } = await supabase
      .from("brand_voice_samples")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    if (samplesData) {
      setSamples(samplesData);
    }

    // Fetch voice profile
    const { data: profileData } = await supabase
      .from("brand_voice_profiles")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (profileData) {
      setVoiceProfile(profileData);
    }

    // Fetch guardrails
    const response = await fetch("/api/guardrails?is_active=true");
    if (response.ok) {
      const { guardrails: guardrailsData } = await response.json();
      setGuardrails(guardrailsData || []);
    }

    setLoading(false);
  };

  const handleAddSample = async () => {
    if (!newSample.trim()) return;

    setAnalyzing(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Add sample to database
    const { data, error } = await supabase
      .from("brand_voice_samples")
      .insert({
        tenant_id: userData.tenant_id,
        content: newSample,
        type: sampleType,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (!error && data) {
      setSamples([data, ...samples]);
      setNewSample("");
    }

    setAnalyzing(false);
  };

  const handleDeleteSample = async (sampleId: string) => {
    const supabase = createClient();
    
    const { error } = await supabase
      .from("brand_voice_samples")
      .delete()
      .eq("id", sampleId);

    if (!error) {
      setSamples(samples.filter(s => s.id !== sampleId));
    }
  };

  const handleTrainVoice = async () => {
    if (samples.length < 5) {
      alert("Please add at least 5 samples to train your brand voice");
      return;
    }

    setTraining(true);

    try {
      // Call API to train voice model
      const response = await fetch("/api/ai/train-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples })
      });

      if (response.ok) {
        const profile = await response.json();
        setVoiceProfile(profile);
      }
    } catch (error) {
      console.error("Training error:", error);
    }

    setTraining(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim());
      
      // Process multiple samples from file
      for (const line of lines.slice(0, 20)) { // Limit to 20 samples
        if (line.length > 50) { // Only add substantial content
          await handleAddSampleFromFile(line);
        }
      }
      
      fetchVoiceData(); // Refresh the list
    };
    reader.readAsText(file);
  };

  const handleAddSampleFromFile = async (content: string) => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    await supabase
      .from("brand_voice_samples")
      .insert({
        tenant_id: userData.tenant_id,
        content: content,
        type: 'custom',
        created_at: new Date().toISOString()
      });
  };

  const handleAddGuardrail = async () => {
    if (!newGuardrail.trim()) return;

    try {
      const response = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context_type: "general",
          feedback_type: guardrailType,
          feedback_text: newGuardrail,
        }),
      });

      if (response.ok) {
        const { guardrail } = await response.json();
        setGuardrails([guardrail, ...guardrails]);
        setNewGuardrail("");
      }
    } catch (error) {
      console.error("Error adding guardrail:", error);
    }
  };

  const handleToggleGuardrail = async (id: string, isActive: boolean) => {
    try {
      const response = await fetch("/api/guardrails", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          is_active: !isActive,
        }),
      });

      if (response.ok) {
        setGuardrails(guardrails.map(g => 
          g.id === id ? { ...g, is_active: !isActive } : g
        ));
      }
    } catch (error) {
      console.error("Error toggling guardrail:", error);
    }
  };

  const handleDeleteGuardrail = async (id: string) => {
    if (!confirm("Are you sure you want to delete this guardrail?")) return;

    try {
      const response = await fetch(`/api/guardrails?id=${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setGuardrails(guardrails.filter(g => g.id !== id));
      }
    } catch (error) {
      console.error("Error deleting guardrail:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Brand Voice Training</h1>
                <p className="text-sm text-text-secondary">
                  Train AI to write in your unique brand voice
                </p>
              </div>
            </div>
            <button
              onClick={handleTrainVoice}
              disabled={training || samples.length < 5}
              className="btn-primary"
            >
              {training ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Training...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Train Voice Model
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Voice Profile Status */}
        {voiceProfile ? (
          <div className="card bg-success/10 border-success/20 mb-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-success mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-success">Voice Model Trained</p>
                <p className="text-sm text-text-secondary mt-1">
                  Last trained: {new Date(voiceProfile.trained_at || '').toLocaleDateString('en-GB')}
                  {' • '}{voiceProfile.sample_count} samples analyzed
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {voiceProfile.tone_attributes.map(attr => (
                    <span key={attr} className="badge-secondary text-xs">
                      {attr}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card bg-warning/10 border-warning/20 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
              <div>
                <p className="font-semibold text-warning">No Voice Model Yet</p>
                <p className="text-sm text-text-secondary mt-1">
                  Add at least 5 samples of your brand's writing to train the AI model
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Add Sample Section */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-4">Add Writing Sample</h3>
          
          <div className="space-y-4">
            <div className="flex gap-2">
              <select
                value={sampleType}
                onChange={(e) => setSampleType(e.target.value as VoiceSample['type'])}
                className="input-field"
              >
                <option value="caption">Social Media Caption</option>
                <option value="blog">Blog Post</option>
                <option value="email">Email</option>
                <option value="menu">Menu Description</option>
                <option value="custom">Other</option>
              </select>
              
              <label className="btn-secondary cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                Upload File
                <input
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <textarea
              value={newSample}
              onChange={(e) => setNewSample(e.target.value)}
              placeholder="Paste a sample of your brand's writing here..."
              className="input-field min-h-32"
            />

            <div className="flex justify-between items-center">
              <p className="text-sm text-text-secondary">
                {newSample.length} characters
              </p>
              <button
                onClick={handleAddSample}
                disabled={!newSample.trim() || analyzing}
                className="btn-primary"
              >
                {analyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Sample
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Samples List */}
        <div className="card">
          <h3 className="font-semibold mb-4">
            Writing Samples ({samples.length})
          </h3>
          
          {samples.length === 0 ? (
            <div className="text-center py-8 text-text-secondary">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No samples added yet</p>
              <p className="text-sm mt-1">Add samples of your brand's writing to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {samples.map((sample) => (
                <div key={sample.id} className="p-4 bg-gray-50 rounded-medium">
                  <div className="flex items-start justify-between mb-2">
                    <span className="badge-primary text-xs">
                      {sample.type}
                    </span>
                    <button
                      onClick={() => handleDeleteSample(sample.id)}
                      className="text-error hover:bg-error/10 p-1 rounded-soft"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-text-primary line-clamp-3">
                    {sample.content}
                  </p>
                  <p className="text-xs text-text-secondary mt-2">
                    Added {new Date(sample.created_at).toLocaleDateString('en-GB')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-4 mb-6 border-b border-border">
          <button
            onClick={() => setActiveTab('samples')}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === 'samples'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            Writing Samples
          </button>
          <button
            onClick={() => setActiveTab('guardrails')}
            className={`pb-3 px-1 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'guardrails'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            <Shield className="w-4 h-4" />
            Content Guardrails
            {guardrails.length > 0 && (
              <span className="badge-primary text-xs">{guardrails.length}</span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'samples' ? (
          <>
            {/* Add Sample Section */}
            <div className="card mb-6">
              <h3 className="font-semibold mb-4">Add Writing Sample</h3>
              
              <div className="space-y-4">
                <div className="flex gap-2">
                  <select
                    value={sampleType}
                    onChange={(e) => setSampleType(e.target.value as VoiceSample['type'])}
                    className="input-field"
                  >
                    <option value="caption">Social Media Caption</option>
                    <option value="blog">Blog Post</option>
                    <option value="email">Email</option>
                    <option value="menu">Menu Description</option>
                    <option value="custom">Other</option>
                  </select>
                  
                  <label className="btn-secondary cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />
                    Upload File
                    <input
                      type="file"
                      accept=".txt,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <textarea
                  value={newSample}
                  onChange={(e) => setNewSample(e.target.value)}
                  placeholder="Paste a sample of your brand's writing here..."
                  className="input-field min-h-32"
                />

                <div className="flex justify-between items-center">
                  <p className="text-sm text-text-secondary">
                    {newSample.length} characters
                  </p>
                  <button
                    onClick={handleAddSample}
                    disabled={!newSample.trim() || analyzing}
                    className="btn-primary"
                  >
                    {analyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Sample
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Samples List */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                Writing Samples ({samples.length})
              </h3>
              
              {samples.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No samples added yet</p>
                  <p className="text-sm mt-1">Add samples of your brand's writing to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {samples.map((sample) => (
                    <div key={sample.id} className="p-4 bg-gray-50 rounded-medium">
                      <div className="flex items-start justify-between mb-2">
                        <span className="badge-primary text-xs">
                          {sample.type}
                        </span>
                        <button
                          onClick={() => handleDeleteSample(sample.id)}
                          className="text-error hover:bg-error/10 p-1 rounded-soft"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-sm text-text-primary line-clamp-3">
                        {sample.content}
                      </p>
                      <p className="text-xs text-text-secondary mt-2">
                        Added {new Date(sample.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tips */}
            <div className="mt-6 p-4 bg-primary/5 rounded-medium">
              <h4 className="font-semibold text-sm mb-2">Tips for Better Results</h4>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Include diverse content types (social posts, emails, descriptions)</li>
                <li>• Add at least 10-15 samples for best results</li>
                <li>• Include your typical hashtags and emoji usage</li>
                <li>• Samples should reflect your ideal brand voice</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            {/* Guardrails Section */}
            <div className="card mb-6">
              <div className="flex items-start gap-3 mb-4">
                <Shield className="w-5 h-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold">Content Guardrails</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    Set rules and preferences for AI-generated content to ensure it matches your brand standards
                  </p>
                </div>
              </div>

              {/* Add Guardrail Form */}
              <div className="space-y-4 p-4 bg-surface rounded-medium">
                <div className="flex gap-2">
                  <select
                    value={guardrailType}
                    onChange={(e) => setGuardrailType(e.target.value as any)}
                    className="input-field"
                  >
                    <option value="avoid">Things to Avoid</option>
                    <option value="include">Things to Include</option>
                    <option value="tone">Tone Preference</option>
                    <option value="style">Style Preference</option>
                    <option value="format">Format Preference</option>
                  </select>
                </div>

                <textarea
                  value={newGuardrail}
                  onChange={(e) => setNewGuardrail(e.target.value)}
                  placeholder={
                    guardrailType === 'avoid' ? "E.g., Avoid using corporate jargon or overly formal language..." :
                    guardrailType === 'include' ? "E.g., Always mention our happy hour specials on Fridays..." :
                    guardrailType === 'tone' ? "E.g., Keep the tone friendly and conversational, not too formal..." :
                    guardrailType === 'style' ? "E.g., Use short, punchy sentences with occasional emojis..." :
                    "E.g., Keep Instagram captions under 125 characters..."
                  }
                  className="input-field min-h-24"
                  maxLength={500}
                />

                <div className="flex justify-between items-center">
                  <p className="text-sm text-text-secondary">
                    {newGuardrail.length}/500 characters
                  </p>
                  <button
                    onClick={handleAddGuardrail}
                    disabled={!newGuardrail.trim()}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Guardrail
                  </button>
                </div>
              </div>
            </div>

            {/* Guardrails List */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                Active Guardrails ({guardrails.filter(g => g.is_active).length})
              </h3>

              {guardrails.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No guardrails set yet</p>
                  <p className="text-sm mt-1">Add guardrails to guide AI content generation</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {guardrails.map((guardrail) => (
                    <div
                      key={guardrail.id}
                      className={`p-4 rounded-medium border ${
                        guardrail.is_active
                          ? 'bg-white border-border'
                          : 'bg-gray-50 border-gray-200 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`badge-${
                            guardrail.feedback_type === 'avoid' ? 'error' :
                            guardrail.feedback_type === 'include' ? 'success' :
                            'primary'
                          } text-xs`}>
                            {guardrail.feedback_type}
                          </span>
                          {guardrail.platform && (
                            <span className="badge-secondary text-xs">
                              {guardrail.platform}
                            </span>
                          )}
                          {guardrail.times_applied > 0 && (
                            <span className="text-xs text-text-secondary">
                              Used {guardrail.times_applied} times
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleGuardrail(guardrail.id, guardrail.is_active)}
                            className="p-1 hover:bg-surface rounded-soft"
                            title={guardrail.is_active ? "Disable" : "Enable"}
                          >
                            {guardrail.is_active ? (
                              <Eye className="w-4 h-4 text-success" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-text-secondary" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteGuardrail(guardrail.id)}
                            className="p-1 hover:bg-error/10 rounded-soft"
                          >
                            <Trash2 className="w-4 h-4 text-error" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-text-primary">
                        {guardrail.feedback_text}
                      </p>
                      <p className="text-xs text-text-secondary mt-2">
                        Added {new Date(guardrail.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Guardrails Info */}
            <div className="mt-6 p-4 bg-primary/5 rounded-medium">
              <h4 className="font-semibold text-sm mb-2">How Guardrails Work</h4>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Guardrails are automatically applied when generating content</li>
                <li>• "Avoid" rules prevent unwanted language or topics</li>
                <li>• "Include" rules ensure important information is mentioned</li>
                <li>• You can disable guardrails temporarily without deleting them</li>
                <li>• Guardrails improve over time as you provide more feedback</li>
              </ul>
            </div>
          </>
        )}
      </main>
    </div>
  );
}