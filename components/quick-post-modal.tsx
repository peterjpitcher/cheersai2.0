"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  X, Send, Calendar, Clock, Sparkles, Image as ImageIcon,
  Facebook, Instagram, MapPin, Loader2, Check, FolderOpen
} from "lucide-react";
import ContentFeedback from "@/components/feedback/content-feedback";

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
  const [inspiration, setInspiration] = useState("");
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

  useEffect(() => {
    if (isOpen) {
      fetchConnections();
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
    if (!inspiration.trim()) {
      alert("Please provide some inspiration or context for the AI to generate content");
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
          prompt: inspiration,
          businessName: userData?.tenant?.name,
          businessType: brandProfile?.business_type || "pub",
          tone: brandProfile?.tone_attributes?.join(", ") || "friendly and engaging",
          targetAudience: brandProfile?.target_audience,
          platforms: selectedPlatforms.length > 0 ? selectedPlatforms : ["facebook"],
        }),
      });

      if (response.ok) {
        const { content: generatedContent } = await response.json();
        setContent(generatedContent);
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

      // Generate unique file name
      const fileExt = file.name.split(".").pop();
      const fileName = `${userData.tenant_id}/quick/${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);

      setMediaUrl(publicUrl);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image");
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (!content || selectedPlatforms.length === 0) {
      alert("Please enter content and select at least one platform");
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

      // Create quick posts for each platform
      const posts = selectedPlatforms.map(platform => ({
        tenant_id: userData.tenant_id,
        content,
        platform,
        scheduled_for: scheduledFor,
        status: scheduleType === "now" ? "scheduled" : "draft",
        // is_quick_post: true, // TODO: Add this column to database
        media_url: mediaUrl,
        post_timing: "immediate",
      }));

      const { error } = await supabase
        .from("campaign_posts")
        .insert(posts);

      if (error) throw error;

      // Success
      if (onSuccess) onSuccess();
      onClose();
      
      // Reset form
      setContent("");
      setInspiration("");
      setSelectedPlatforms([]);
      setScheduleType("now");
      setMediaUrl(null);
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
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Quick Post</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Platform Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">Select Platforms</label>
            <div className="space-y-2">
              {connections.map(conn => (
                <button
                  key={conn.id}
                  onClick={() => togglePlatform(conn.platform)}
                  className={`w-full p-3 rounded-lg border-2 transition-all flex items-center gap-3 ${
                    selectedPlatforms.includes(conn.platform)
                      ? "border-primary bg-primary/5"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    conn.platform === "instagram_business" ? "bg-gradient-to-br from-purple-600 to-pink-500" :
                    conn.platform === "facebook" ? "bg-blue-600" :
                    "bg-green-600"
                  }`}>
                    {conn.platform === "instagram_business" ? <Instagram className="w-5 h-5 text-white" /> :
                     conn.platform === "facebook" ? <Facebook className="w-5 h-5 text-white" /> :
                     <MapPin className="w-5 h-5 text-white" />}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium capitalize">{conn.platform === "instagram_business" ? "Instagram Business" : conn.platform}</p>
                    <p className="text-sm text-gray-600">{conn.account_name}</p>
                  </div>
                  {selectedPlatforms.includes(conn.platform) && (
                    <Check className="w-5 h-5 text-primary" />
                  )}
                </button>
              ))}
            </div>
            {connections.length === 0 && (
              <p className="text-sm text-gray-500">
                No social accounts connected. 
                <a href="/settings/connections" className="text-primary hover:underline ml-1">
                  Connect accounts
                </a>
              </p>
            )}
          </div>

          {/* AI Inspiration */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2">AI Content Inspiration</label>
                <input
                  type="text"
                  value={inspiration}
                  onChange={(e) => setInspiration(e.target.value)}
                  placeholder="E.g., Quiz night tonight, Live music Saturday, New menu launch..."
                  className="input-field text-sm mb-3"
                />
                <button
                  onClick={handleGenerateContent}
                  disabled={generating || !inspiration.trim()}
                  className="btn-primary text-sm flex items-center gap-2"
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

          {/* Content Input */}
          <div>
            <label className="block text-sm font-medium mb-2">Post Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={content ? "" : "Write your own content or use AI to generate it above"}
              className="input-field min-h-[120px]"
              maxLength={500}
            />
            <p className="text-xs text-gray-500 mt-1">{content.length}/500 characters</p>
            
            {/* Add feedback component when content is generated */}
            {content && inspiration && (
              <ContentFeedback
                content={content}
                prompt={inspiration}
                platform={selectedPlatforms[0]}
                generationType="quick_post"
                className="mt-3"
              />
            )}
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Add Image (Optional)</label>
            {mediaUrl ? (
              <div className="relative">
                <img src={mediaUrl} alt="Upload" className="w-full h-48 object-cover rounded-lg" />
                <button
                  onClick={() => setMediaUrl(null)}
                  className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="file"
                  id="quick-image-upload"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label
                  htmlFor="quick-image-upload"
                  className="btn-secondary inline-flex items-center cursor-pointer"
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
                  className="btn-secondary inline-flex items-center"
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
                              setMediaUrl(image.url);
                              setShowMediaLibrary(false);
                            }}
                            className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-colors"
                          >
                            <img
                              src={image.url}
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
                    className="input-field"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Time</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !content || selectedPlatforms.length === 0}
            className="btn-primary flex items-center gap-2"
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