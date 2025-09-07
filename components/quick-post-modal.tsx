"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import {
  X, Send, Calendar, Clock, Sparkles, Image as ImageIcon,
  Facebook, Instagram, MapPin, Loader2, Check, FolderOpen
} from "lucide-react";
import ContentFeedback from "@/components/feedback/content-feedback";
import PlatformBadge from "@/components/ui/platform-badge";

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
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
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
      // Auto-select first platform
      if (data.length > 0) {
        setSelectedPlatforms([data[0].platform]);
      }
    }
  };

  const handleGenerateContent = async () => {
    const context = creativeMode === 'free'
      ? inspiration.trim()
      : [q1 && `What: ${q1}`, q2 && `Why: ${q2}`, q3 && `Action: ${q3}`, q4 && `Where: ${q4}`, q5 && `Details: ${q5}`]
          .filter(Boolean)
          .join('\n');
    if (!context) {
      alert('Please provide some inspiration or answer a few questions');
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
      } else {
        throw new Error("Failed to generate content");
      }
    } catch (error) {
      console.error("Generation error:", error);
      alert("Failed to generate content. Please try again.");
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
      alert("Please select a supported image file (JPG, PNG, GIF, WEBP, HEIC, HEIF)");
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be less than 5MB");
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
        alert("Failed to process the image. This may be due to an unsupported camera format.");
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
    } catch (error) {
      console.error("Upload error:", error);
      if (error instanceof Error) {
        alert(`Failed to upload image: ${error.message}`);
      } else {
        alert("Failed to upload image. Please try again or try a different image format.");
      }
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (selectedPlatforms.length === 0) {
      alert("Please select at least one platform");
      return;
    }
    // Validate that each selected platform has content (per‑platform or fallback)
    const missing = selectedPlatforms.filter(p => !((contentByPlatform[p] || content) || '').trim());
    if (missing.length > 0) {
      alert("Please enter content for all selected platforms");
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

      // Create quick posts for each platform (use per-platform content if present)
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
        const publishCalls = inserted.map(async (p: any) => {
          // Find a matching active connection for this platform
          const platformKey = p.platform; // e.g., 'facebook', 'instagram_business', 'google_my_business'
          const conn = connections.find(c => c.platform === platformKey);
          if (!conn) return { success: false, error: `No active connection for ${platformKey}` };
          const resp = await fetch('/api/social/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: p.id,
              content: (contentByPlatform[platformKey] || content).trim(),
              connectionIds: [conn.id],
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
      setSelectedPlatforms([]);
      setScheduleType("now");
      setMediaUrl(null);
      setContentByPlatform({});
    } catch (error) {
      console.error("Error creating quick post:", error);
      alert("Failed to create post");
    }
    setLoading(false);
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-large max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-heading font-bold">Quick Post</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-background rounded-medium transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Platform Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">Select Platforms</label>
            <div className="space-y-2">
              {connections.map(conn => {
                const selected = selectedPlatforms.includes(conn.platform);
                return (
                  <button
                    key={conn.id}
                    onClick={() => togglePlatform(conn.platform)}
                    className={`w-full p-3 rounded-medium border-2 transition-colors flex items-center gap-3 ${selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                  >
                    <div className="flex-shrink-0"><PlatformBadge platform={conn.platform} size="md" showLabel={false} /></div>
                    <div className="flex-1 text-left">
                      <p className="font-medium capitalize">{conn.platform === 'instagram_business' ? 'Instagram Business' : conn.platform.replace('_',' ')}</p>
                      <p className="text-sm text-text-secondary">{conn.account_name}</p>
                    </div>
                    {selected && <Check className="w-5 h-5 text-primary" />}
                  </button>
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
                      onChange={(e) => setInspiration(e.target.value)}
                      placeholder="E.g., Tonight’s quiz from 7pm, prizes, book at cheersbar.co.uk/quiz"
                      className="text-sm mb-3 min-h-[90px] border border-input rounded-md px-3 py-2 w-full"
                    />
                  </>
                ) : (
                  <div className="grid gap-2">
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="What’s happening? (e.g., Quiz tonight 7pm)" value={q1} onChange={e=>setQ1(e.target.value)} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="Why should people care? (fun, prizes, atmosphere)" value={q2} onChange={e=>setQ2(e.target.value)} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="What should people do? (book, call, click)" value={q3} onChange={e=>setQ3(e.target.value)} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="Link or phone (e.g., cheersbar.co.uk/quiz or 0161 123 4567)" value={q4} onChange={e=>setQ4(e.target.value)} />
                    <input className="border border-input rounded-md px-3 py-2 text-sm" placeholder="Any details? (e.g., teams up to 6)" value={q5} onChange={e=>setQ5(e.target.value)} />
                  </div>
                )}
                <button
                  onClick={handleGenerateContent}
                  disabled={generating || (creativeMode==='free' ? !inspiration.trim() : !(q1||q2||q3||q4||q5))}
                  className="bg-primary text-white rounded-md px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Content
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Per-platform Content Inputs */}
          <div className="space-y-3">
            <label className="block text-sm font-medium">Post Content</label>
            {selectedPlatforms.length === 0 ? (
              <p className="text-sm text-text-secondary">Select at least one platform to edit content.</p>
            ) : (
              selectedPlatforms.map(p => (
                <div key={p} className="border border-border rounded-medium p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium capitalize">{p.replace('_',' ')}</span>
                    <span className="text-xs text-text-secondary">{(contentByPlatform[p]||'').length}/500</span>
                  </div>
                  <textarea
                    value={contentByPlatform[p] || ''}
                    onChange={(e) => setContentByPlatform(prev => ({ ...prev, [p]: sanitizeForPlatform(p, e.target.value) }))}
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
              ))
            )}
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Add Image (Optional)</label>
            {mediaUrl ? (
              <div className="relative">
                <div className="aspect-square w-full rounded-lg overflow-hidden bg-gray-100">
                  <img src={mediaUrl} alt="Upload" className="w-full h-full object-cover" />
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
                <label
                  htmlFor="quick-image-upload"
                  className="border border-input rounded-md h-10 px-4 text-sm inline-flex items-center cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Upload New
                    </>
                  )}
                </label>
                <button
                  onClick={() => {
                    fetchMediaLibrary();
                    setShowMediaLibrary(true);
                  }}
                  className="border border-input rounded-md h-10 px-4 text-sm inline-flex items-center"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Media Library
                </button>
              </div>
            )}
            
            {/* Media Library Modal */}
            {showMediaLibrary && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
                  <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Select from Media Library</h3>
                    <button
                      onClick={() => setShowMediaLibrary(false)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
                    {mediaLibraryImages.length > 0 ? (
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                        {mediaLibraryImages.map((image) => (
                          <button
                            key={image.id}
                            onClick={() => {
                              setMediaUrl(image.file_url);
                              setShowMediaLibrary(false);
                            }}
                            className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-colors"
                          >
                            <img
                              src={image.file_url}
                              alt={image.alt_text || ""}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <ImageIcon className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                        <p className="text-gray-500">No images in your media library yet</p>
                        <Link href="/media" className="text-primary hover:underline text-sm mt-2 inline-block">
                          Go to Media Library →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
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
          <button onClick={onClose} className="text-text-secondary hover:bg-muted rounded-md px-3 py-2">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || selectedPlatforms.length === 0 || selectedPlatforms.some(p => !(contentByPlatform[p] || content).trim())}
            className="bg-primary text-white rounded-md px-3 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {scheduleType === "now" ? "Post Now" : "Schedule Post"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
