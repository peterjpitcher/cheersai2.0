"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import {
  X, Save, Loader2, Sparkles, Image as ImageIcon,
  Calendar, Clock, Facebook, Instagram, MapPin,
  Check, FolderOpen, Trash2, AlertCircle
} from "lucide-react";
import PlatformBadge from "@/components/ui/platform-badge";
import ContentFeedback from "@/components/feedback/content-feedback";

interface MediaAsset {
  id: string;
  file_url: string;
  alt_text?: string;
  has_watermark?: boolean;
}

interface PostEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  post: {
    id: string;
    content: string;
    platform?: string;
    platforms?: string[];
    scheduled_for?: string;
    status?: string;
    is_quick_post?: boolean;
    media_url?: string;
    media_assets?: MediaAsset[];
    campaign?: {
      id: string;
      name: string;
      status: string;
      event_date?: string;
    };
  };
}

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string;
  is_active: boolean;
}

const PLATFORM_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  instagram_business: Instagram,
  google_my_business: MapPin,
};

const PLATFORM_COLORS = {
  facebook: "text-blue-600",
  instagram: "text-pink-600",
  instagram_business: "text-pink-600", 
  google_my_business: "text-green-600",
};

export default function PostEditModal({ isOpen, onClose, onSuccess, post }: PostEditModalProps) {
  const [content, setContent] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [mediaLibraryImages, setMediaLibraryImages] = useState<any[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (isOpen && post) {
      // Initialize form with post data
      setContent(post.content || "");
      
      // Set platforms
      const platforms = post.platforms || (post.platform ? [post.platform] : []);
      setSelectedPlatforms(platforms);
      
      // Set scheduled time
      if (post.scheduled_for) {
        const scheduledDateTime = new Date(post.scheduled_for);
        setScheduledDate(scheduledDateTime.toISOString().split("T")[0]);
        setScheduledTime(scheduledDateTime.toTimeString().slice(0, 5));
      } else {
        // Default to 1 hour from now
        const future = new Date();
        future.setHours(future.getHours() + 1);
        setScheduledDate(future.toISOString().split("T")[0]);
        setScheduledTime(future.toTimeString().slice(0, 5));
      }
      
      // Set media
      setMediaUrl(post.media_url || null);
      
      // Fetch connections
      fetchConnections();
    }
  }, [isOpen, post]);

  const fetchConnections = async () => {
    setLoading(true);
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
    }
    setLoading(false);
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

  const handleGenerateContent = async () => {
    if (!originalPrompt.trim()) {
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
          prompt: originalPrompt,
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
      const fileName = `${userData.tenant_id}/posts/${Date.now()}.${finalExt}`;

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

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const handleSave = async () => {
    if (!content.trim()) {
      alert("Please enter post content");
      return;
    }

    if (selectedPlatforms.length === 0) {
      alert("Please select at least one platform");
      return;
    }

    setSaving(true);

    try {
      const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          scheduled_for: scheduledFor,
          platforms: selectedPlatforms,
          platform: selectedPlatforms[0], // Keep backward compatibility
          media_url: mediaUrl,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (onSuccess) onSuccess();
        onClose();
        alert("Post updated successfully");
      } else {
        alert(data.error || "Failed to update post");
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);

    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (response.ok) {
        if (onSuccess) onSuccess();
        onClose();
        alert("Post deleted successfully");
      } else {
        alert(data.error || "Failed to delete post");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete post. Please try again.");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-large max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-heading font-bold">Edit Post</h2>
              <p className="text-sm text-text-secondary mt-1">
                {post.campaign?.name || (post.is_quick_post ? "Quick Post" : "Individual Post")}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Post Status Warning */}
          {post.status === "published" && (
            <div className="bg-warning/10 border border-warning/20 rounded-medium p-4">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Published Post</p>
                  <p className="text-sm text-text-secondary mt-1">
                    This post has already been published. Changes will only affect the scheduled version.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* AI Regeneration */}
          <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2">Regenerate Content with AI</label>
                <input
                  type="text"
                  value={originalPrompt}
                  onChange={(e) => setOriginalPrompt(e.target.value)}
                  placeholder="Enter new prompt to regenerate content..."
                  className="input-field text-sm mb-3"
                />
                <button
                  onClick={handleGenerateContent}
                  disabled={generating || !originalPrompt.trim()}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Regenerate Content
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Content Editor */}
          <div>
            <label className="block text-sm font-medium mb-2">Post Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter your post content..."
              className="input-field min-h-[120px]"
              maxLength={500}
            />
            <p className="text-xs text-text-secondary mt-1">{content.length}/500 characters</p>
            
            {/* Content Feedback */}
            {content && originalPrompt && (
              <ContentFeedback
                content={content}
                prompt={originalPrompt}
                platform={selectedPlatforms[0]}
                generationType="other"
                onRegenerate={handleGenerateContent}
                className="mt-3"
              />
            )}
          </div>

          {/* Platform Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">Target Platforms</label>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : connections.length === 0 ? (
              <div className="bg-warning/10 border border-warning/20 rounded-medium p-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">No Connected Accounts</p>
                    <p className="text-sm text-text-secondary mt-1">
                      Connect your social media accounts in Settings to start publishing.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {connections.map((connection) => {
                  const Icon = PLATFORM_ICONS[connection.platform as keyof typeof PLATFORM_ICONS] || MapPin;
                  const isSelected = selectedPlatforms.includes(connection.platform);

                  return (
                    <label
                      key={connection.id}
                      className={`flex items-center gap-3 p-3 border rounded-medium cursor-pointer transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => togglePlatform(connection.platform)}
                        className="w-4 h-4 text-primary"
                      />
                      <Icon className={`w-5 h-5 ${PLATFORM_COLORS[connection.platform as keyof typeof PLATFORM_COLORS] || "text-gray-600"}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {connection.page_name || connection.account_name}
                        </p>
                        <p className="text-xs text-text-secondary capitalize">
                          {connection.platform.replace("_", " ")}
                        </p>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Schedule Settings */}
          <div>
            <label className="block text-sm font-medium mb-3">Scheduled Time</label>
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
          </div>

          {/* Media Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Post Image</label>
            {mediaUrl ? (
              <div className="relative">
                <img src={mediaUrl} alt="Post media" className="w-full h-48 object-cover rounded-medium" />
                <button
                  onClick={() => setMediaUrl(null)}
                  className="absolute top-2 right-2 p-1 bg-surface rounded-full shadow-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="file"
                  id="edit-image-upload"
                  accept="image/*,.heic,.heif"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label
                  htmlFor="edit-image-upload"
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
                <div className="bg-surface rounded-large max-w-4xl w-full max-h-[80vh] overflow-hidden">
                  <div className="sticky top-0 bg-surface border-b px-6 py-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Select from Media Library</h3>
                    <button
                      onClick={() => setShowMediaLibrary(false)}
                      className="p-2 hover:bg-background rounded-lg transition-colors"
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
                            className="aspect-square rounded-medium overflow-hidden border-2 border-transparent hover:border-primary transition-colors"
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
                        <ImageIcon className="w-12 h-12 mx-auto text-text-secondary mb-3" />
                        <p className="text-text-secondary">No images in your media library yet</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-ghost text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Post
            </button>
            
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="btn-secondary"
                disabled={saving || deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="btn-primary flex items-center gap-2"
                disabled={saving || deleting || !content.trim() || selectedPlatforms.length === 0}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-medium p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold mb-3">Confirm Deletion</h3>
              <p className="text-text-secondary mb-6">
                Are you sure you want to delete this post? This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="btn-secondary"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-2"
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}