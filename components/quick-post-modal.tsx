"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import {
  X, Send, Calendar, Clock, Sparkles, Image as ImageIcon,
  Facebook, Instagram, MapPin, Loader2, Check, FolderOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ContentFeedback from "@/components/feedback/content-feedback";
import PlatformBadge from "@/components/ui/platform-badge";
import { TERMS } from "@/lib/copy";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface QuickPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  defaultDate?: Date | null;
}

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string | null;
  is_active: boolean;
}

export default function QuickPostModal({ isOpen, onClose, onSuccess, defaultDate }: QuickPostModalProps) {
  const [content, setContent] = useState("");
  const [contentByPlatform, setContentByPlatform] = useState<Record<string, string>>({});
  const [inspiration, setInspiration] = useState("");
  const [creativeMode, setCreativeMode] = useState<'free' | 'guided'>('free');
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [q3, setQ3] = useState('');
  const [q4, setQ4] = useState('');
  const [q5, setQ5] = useState('');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [scheduleType, setScheduleType] = useState<"now" | "later">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [mediaLibraryImages, setMediaLibraryImages] = useState<any[]>([]);
  const [brandProfile, setBrandProfile] = useState<any | null>(null);
  // Inline error states per section (replace alert())
  const [genError, setGenError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchConnections();
      fetchBrandProfile();
      // Use defaultDate if provided, otherwise 1 hour from now
      const future = defaultDate || new Date();
      if (!defaultDate) {
        future.setHours(future.getHours() + 1);
      }
      setScheduledDate(future.toISOString().split('T')[0]);
      setScheduledTime(future.toTimeString().slice(0, 5));
      
      // If defaultDate is provided, default to scheduling for later
      if (defaultDate) {
        setScheduleType("later");
      }
    }
  }, [isOpen, defaultDate]);

  const fetchBrandProfile = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).single();
    if (!u?.tenant_id) return;
    const { data: bp } = await supabase.from('brand_profiles').select('*').eq('tenant_id', u.tenant_id).single();
    if (bp) setBrandProfile(bp);
  };

  const addBookingLink = (platform: string) => {
    const url = brandProfile?.booking_url || brandProfile?.website_url;
    if (!url) return;
    setContentByPlatform(prev => ({
      ...prev,
      [platform]: (prev[platform] || '').trim().endsWith(url) ? prev[platform] : `${(prev[platform] || '')}\n${url}`
    }));
  };

  const sanitizeForPlatform = (platform: string, text: string): string => {
    if (platform === 'instagram_business') {
      // Remove raw URLs
      const withoutUrls = text.replace(/https?:\/\/\S+|www\.[^\s]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      return withoutUrls;
    }
    return text;
  };

  const fetchMediaLibrary = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Fetch media assets from database
    const { data: assets } = await supabase
      .from("media_assets")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (assets) {
      setMediaLibraryImages(assets);
    }
  };

  const fetchConnections = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    const { data } = await supabase
      .from("social_connections")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .eq("is_active", true);

    if (data) {
      setConnections(data);
      // Do not auto-select accounts; user must choose explicitly
    }
  };

  const handleGenerateContent = async () => {
    const context = creativeMode === 'free'
      ? inspiration.trim()
      : [q1 && `What: ${q1}`, q2 && `Why: ${q2}`, q3 && `Action: ${q3}`, q4 && `Where: ${q4}`, q5 && `Details: ${q5}`]
          .filter(Boolean)
          .join('\n');
    if (!context) {
      setGenError('Please provide some inspiration or answer a few questions');
      return;
    }
    
    setGenerating(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData } = await supabase
        .from("users")
        .select(`
          tenant_id,
          tenant:tenants(name)
        `)
        .eq("id", user.id)
        .single();

      // Get brand profile for tone
      const { data: brandProfile } = await supabase
        .from("brand_profiles")
        .select("business_type, tone_attributes, target_audience")
        .eq("tenant_id", userData?.tenant_id)
        .single();

    // Derive platforms from selected accounts
    const selectedPlatforms = Array.from(new Set(
      connections.filter(c => selectedConnectionIds.includes(c.id)).map(c => c.platform)
    ));

    const response = await fetch("/api/generate/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: context,
        businessName: userData?.tenant?.name,
        businessType: brandProfile?.business_type || "pub",
        tone: brandProfile?.tone_attributes?.join(", ") || "friendly and engaging",
        targetAudience: brandProfile?.target_audience,
        platforms: selectedPlatforms.length > 0 ? selectedPlatforms : ["facebook"],
      }),
    });

      if (response.ok) {
        const { contents } = await response.json();
        setContent('');
        setContentByPlatform(contents || {});
        setGenError(null);
      } else {
        throw new Error("Failed to generate content");
      }
    } catch (error) {
      console.error("Generation error:", error);
      setGenError("Failed to generate content. Please try again.");
    }
    setGenerating(false);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type - include HEIC/HEIF formats from camera
    const isValidImage = file.type.startsWith("image/") || 
                        file.type.includes("heic") || 
                        file.type.includes("heif") ||
                        file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
    
    if (!isValidImage) {
      setUploadError("Please select a supported image file (JPG, PNG, GIF, WEBP, HEIC, HEIF)");
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image must be less than 5MB");
      return;
    }

    setUploading(true);
    const supabase = createClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) throw new Error("No tenant");

      // Compress image before upload
      let compressedFile;
      try {
        compressedFile = await compressImage(file);
      } catch (compressionError) {
        console.error("Image compression failed:", compressionError);
        setUploadError("Failed to process the image. This may be due to an unsupported camera format.");
        return;
      }

      // Generate unique file name - handle HEIC/HEIF conversion
      const originalExt = file.name.split(".").pop()?.toLowerCase();
      const isHEIC = originalExt === "heic" || originalExt === "heif";
      const finalExt = isHEIC ? "jpg" : originalExt;
      const fileName = `${userData.tenant_id}/quick/${Date.now()}.${finalExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, compressedFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);

      setMediaUrl(publicUrl);
      setUploadError(null);
    } catch (error) {
      console.error("Upload error:", error);
      if (error instanceof Error) {
        setUploadError(`Failed to upload image: ${error.message}`);
      } else {
        setUploadError("Failed to upload image. Please try again or try a different image format.");
      }
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (selectedConnectionIds.length === 0) {
      setAccountsError("Please select at least one social account");
      return;
    }
    // Derive platforms from selected accounts and validate content per platform
    const selectedPlatforms = Array.from(new Set(
      connections.filter(c => selectedConnectionIds.includes(c.id)).map(c => c.platform)
    ));
    const missing = selectedPlatforms.filter(p => !((contentByPlatform[p] || content) || '').trim());
    if (missing.length > 0) {
      setContentError("Please enter content for all selected platforms");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) throw new Error("No tenant");

      // Calculate scheduled time
      let scheduledFor = new Date().toISOString();
      if (scheduleType === "later") {
        scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
      }

      // Create one quick post per platform (use per-platform content if present)
      const posts = selectedPlatforms.map(platform => ({
        tenant_id: userData.tenant_id,
        content: (contentByPlatform[platform] || content).trim(),
        platform,
        scheduled_for: scheduledFor,
        status: scheduleType === "now" ? "published" : scheduleType === "later" ? "scheduled" : "draft",
        is_quick_post: true,
        media_url: mediaUrl,
        post_timing: scheduleType === "now" ? "immediate" : "scheduled",
        approval_status: 'approved',
      }));

      const { data: inserted, error } = await supabase
        .from("campaign_posts")
        .insert(posts)
        .select('id, platform');

      if (error) throw error;

      // Publish or schedule via server for each inserted post
      if (inserted && inserted.length > 0) {
        // Map platforms to selected connection IDs
        const platformToConnections: Record<string, string[]> = {};
        for (const platform of selectedPlatforms) {
          platformToConnections[platform] = connections
            .filter(c => c.platform === platform && selectedConnectionIds.includes(c.id))
            .map(c => c.id);
        }

        const publishCalls = inserted.map(async (p: any) => {
          const platformKey = p.platform;
          const targetIds = platformToConnections[platformKey] || [];
          if (targetIds.length === 0) {
            return { success: false, error: `No selected accounts for ${platformKey}` };
          }
          const resp = await fetch('/api/social/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: p.id,
              content: (contentByPlatform[platformKey] || content).trim(),
              connectionIds: targetIds,
              imageUrl: mediaUrl,
              scheduleFor: scheduleType === 'later' ? scheduledFor : undefined,
            })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) return { success: false, error: data?.error || 'Failed to publish' };
          const ok = Array.isArray(data.results) && data.results.some((r: any) => r.success);
          return { success: !!ok };
        });
        await Promise.allSettled(publishCalls);
      }

      // Success
      if (onSuccess) onSuccess();
      onClose();

      // Reset form
      setContent("");
      setInspiration("");
      setSelectedConnectionIds([]);
      setScheduleType("now");
      setMediaUrl(null);
      setContentByPlatform({});
    } catch (error) {
      console.error("Error creating quick post:", error);
      setSubmitError("Failed to create post");
    }
    setLoading(false);
  };

  const toggleConnection = (connectionId: string) => {
    setSelectedConnectionIds(prev => {
      const next = prev.includes(connectionId)
        ? prev.filter(id => id !== connectionId)
        : [...prev, connectionId];
      if (next.length > 0) setAccountsError(null);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="h-[100dvh] sm:h-auto sm:max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="sticky top-0 bg-surface border-b border-border px-6 py-4">
          <DialogTitle className="text-xl font-heading">Quick Post</DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Submit-level error */}
          {submitError && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-3">
              {submitError}
            </div>
          )}
          {/* Account Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">Select Accounts</label>
            <div className="space-y-2">
              {connections.map(conn => {
                const selected = selectedConnectionIds.includes(conn.id);
                const label = conn.platform === 'instagram_business'
                  ? 'Instagram'
                  : conn.platform === 'google_my_business'
                    ? TERMS.GBP
                    : conn.platform.replace('_',' ');
                return (
                  <label
                    key={conn.id}
                    className={`w-full p-3 rounded-medium border-2 transition-colors flex items-center gap-3 cursor-pointer ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={selected}
                      onChange={() => toggleConnection(conn.id)}
                    />
                    <div className="flex-shrink-0"><PlatformBadge platform={conn.platform} size="md" showLabel={false} /></div>
                    <div className="flex-1 text-left">
                      <p className="font-medium capitalize">{label}</p>
                      <p className="text-sm text-text-secondary">{conn.page_name || conn.account_name}</p>
                    </div>
                    {selected && <Check className="w-5 h-5 text-primary" />}
                  </label>
                );
              })}
            </div>
            {connections.length === 0 && (
              <p className="text-sm text-text-secondary">
                No social accounts connected. 
                <a href="/settings/connections" className="text-primary hover:underline ml-1">
                  Connect accounts
                </a>
              </p>
            )}
            {accountsError && (
              <div className="mt-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                {accountsError}
              </div>
            )}
          </div>

          {/* AI Inspiration */}
          <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <div className="inline-flex rounded-medium border border-border overflow-hidden mb-3">
                  {(['free','guided'] as const).map(mode => (
                    <button key={mode} onClick={() => setCreativeMode(mode)} className={`px-3 py-1.5 text-sm ${creativeMode===mode?'bg-primary text-white':'bg-background'} ${mode!=='free'?'border-l border-border':''}`}>
                      {mode==='free'?'Simple text':'Answer a few questions'}
                    </button>
                  ))}
                </div>
                {creativeMode==='free' ? (
                  <>
                    <label className="block text-sm font-medium mb-2">AI Content Inspiration</label>
                    <textarea
                      value={inspiration}
                      onChange={(e) => { setInspiration(e.target.value); if (e.target.value.trim()) setGenError(null); }}
                      placeholder="E.g., Tonight’s quiz from 7pm, prizes, book at cheersbar.co.uk/quiz"
                      className="text-sm mb-3 min-h-[90px] border border-input rounded-md px-3 py-2 w-full"
                    />
                  </>
                ) : (
                  <div className="grid gap-2">
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="What’s happening? (e.g., Quiz tonight 7pm)" value={q1} onChange={e=>{ setQ1(e.target.value); setGenError(null); }} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="Why should people care? (fun, prizes, atmosphere)" value={q2} onChange={e=>{ setQ2(e.target.value); setGenError(null); }} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="What should people do? (book, call, click)" value={q3} onChange={e=>{ setQ3(e.target.value); setGenError(null); }} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="Link or phone (e.g., cheersbar.co.uk/quiz or 0161 123 4567)" value={q4} onChange={e=>{ setQ4(e.target.value); setGenError(null); }} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="Any details? (e.g., teams up to 6)" value={q5} onChange={e=>{ setQ5(e.target.value); setGenError(null); }} />
                  </div>
                )}
                <Button
                  onClick={handleGenerateContent}
                  loading={generating}
                  disabled={(creativeMode==='free' ? !inspiration.trim() : !(q1||q2||q3||q4||q5))}
                  size="sm"
                >
                  {!generating && <Sparkles className="w-4 h-4" />}
                  Generate Content
                </Button>
              </div>
            </div>
            {genError && (
              <div className="mt-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                {genError}
              </div>
            )}
          </div>

          {/* Per-platform Content Inputs */}
          <div className="space-y-3">
            <label className="block text-sm font-medium">Post Content</label>
            {(() => {
              const selectedPlatforms = Array.from(new Set(
                connections.filter(c => selectedConnectionIds.includes(c.id)).map(c => c.platform)
              ));
              if (selectedPlatforms.length === 0) {
                return (
                  <p className="text-sm text-text-secondary">Select at least one account to edit content.</p>
                );
              }
              return selectedPlatforms.map(p => (
                <div key={p} className="border border-border rounded-medium p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium capitalize">{p.replace('_',' ')}</span>
                    <span className="text-xs text-text-secondary">{(contentByPlatform[p]||'').length}/500</span>
                  </div>
                  <textarea
                    value={contentByPlatform[p] || ''}
                    onChange={(e) => { setContentByPlatform(prev => ({ ...prev, [p]: sanitizeForPlatform(p, e.target.value) })); if ((e.target.value || '').trim()) setContentError(null); }}
                    placeholder="Write or generate content for this platform"
                    className="min-h-[100px] text-sm border border-input rounded-md px-3 py-2 w-full"
                    maxLength={500}
                  />
                  <div className="mt-2 text-xs text-text-secondary space-y-1">
                    {p === 'instagram_business' && /https?:\/\/|www\./i.test(contentByPlatform[p] || '') && (
                      <div>Instagram posts should avoid links; use 'link in bio'. We’ll remove URLs automatically.</div>
                    )}
                    {brandProfile && (p === 'facebook' || p === 'twitter') && (brandProfile.booking_url || brandProfile.website_url) && !((contentByPlatform[p] || '').includes(brandProfile.booking_url || '')) && (
                      <button onClick={() => addBookingLink(p)} className="underline hover:text-primary">Insert booking link</button>
                    )}
                  </div>
                  { (contentByPlatform[p] || '').trim() && (
                    <ContentFeedback
                      content={contentByPlatform[p]}
                      prompt={inspiration}
                      platform={p}
                      generationType="quick_post"
                      onRegenerate={handleGenerateContent}
                      className="mt-2"
                    />
                  )}
                </div>
              ));
            })()}
            {contentError && (
              <div className="mt-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                {contentError}
              </div>
            )}
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Add Image (Optional)</label>
            {mediaUrl ? (
              <div className="relative">
                <div className="aspect-square w-full rounded-lg overflow-hidden bg-gray-100 relative">
                  <img src={mediaUrl} alt="Upload" className="w-full h-full object-cover" width="600" height="600" />
                </div>
                <button
                  onClick={() => setMediaUrl(null)}
                  className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  id="quick-image-upload"
                  accept="image/*,.heic,.heif"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label htmlFor="quick-image-upload" className="inline-flex">
                  <Button variant="outline" size="sm" loading={uploading}>
                    {!uploading && <ImageIcon className="w-4 h-4 mr-1" />}
                    Upload New
                  </Button>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { fetchMediaLibrary(); setShowMediaLibrary(true); }}
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Media Library
                </Button>
              </div>
            )}
            {uploadError && (
              <div className="mt-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                {uploadError}
              </div>
            )}
            
            {/* Media Library Modal */}
            {showMediaLibrary && (
              <Dialog open={showMediaLibrary} onOpenChange={setShowMediaLibrary}>
                <DialogContent className="max-w-4xl p-0 overflow-hidden">
                  <DialogHeader className="sticky top-0 bg-surface border-b px-6 py-4">
                    <DialogTitle className="text-lg">Select from Media Library</DialogTitle>
                  </DialogHeader>
                  <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
                    {mediaLibraryImages.length > 0 ? (
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                        {mediaLibraryImages.map((image) => (
                          <button
                            key={image.id}
                            onClick={() => { setMediaUrl(image.file_url || image.url); setShowMediaLibrary(false); }}
                            className="aspect-square rounded-medium overflow-hidden border-2 border-transparent hover:border-primary transition-colors relative"
                          >
                            <img src={image.file_url || image.url} alt={image.alt_text || ''} className="w-full h-full object-cover" width="160" height="160" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <ImageIcon className="w-12 h-12 mx-auto text-text-secondary mb-3" />
                        <p className="text-text-secondary">No images in your media library yet</p>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Schedule Options */}
          <div>
            <label className="block text-sm font-medium mb-3">When to Post</label>
            <div className="flex gap-3 mb-3">
              <button
                onClick={() => setScheduleType("now")}
                className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                  scheduleType === "now"
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Send className="w-5 h-5 mx-auto mb-1" />
                <p className="text-sm font-medium">Post Now</p>
              </button>
              <button
                onClick={() => setScheduleType("later")}
                className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                  scheduleType === "later"
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Calendar className="w-5 h-5 mx-auto mb-1" />
                <p className="text-sm font-medium">Schedule</p>
              </button>
            </div>

            {scheduleType === "later" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Date</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="border border-input rounded-md px-3 py-2 w-full"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Time</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="border border-input rounded-md px-3 py-2 w-full"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          {(() => {
            const selectedPlatforms = Array.from(new Set(
              connections.filter(c => selectedConnectionIds.includes(c.id)).map(c => c.platform)
            ));
            const hasMissing = selectedPlatforms.some(p => !(contentByPlatform[p] || content).trim());
            return (
              <Button onClick={handleSubmit} loading={loading} disabled={selectedConnectionIds.length === 0 || hasMissing}>
                {!loading && <Send className="w-4 h-4" />}
                {scheduleType === "now" ? "Post Now" : "Schedule Post"}
              </Button>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
