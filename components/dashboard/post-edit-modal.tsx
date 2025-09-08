"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import { toast } from 'sonner';
import { 
  X, Save, Loader2, Image as ImageIcon,
  FolderOpen, Trash2, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/ui/platform-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Image from 'next/image';

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

export default function PostEditModal({ isOpen, onClose, onSuccess, post }: PostEditModalProps) {
  const [content, setContent] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [libraryUploading, setLibraryUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [mediaLibraryImages, setMediaLibraryImages] = useState<any[]>([]);
  const [libraryUploadError, setLibraryUploadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isPublished = post?.status === 'published';
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

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
      
      // Set media (fallback to first media asset file_url if media_url is missing)
      const fallbackUrl = (post.media_assets && post.media_assets.length > 0) ? post.media_assets[0].file_url : null;
      setMediaUrl(post.media_url || fallbackUrl || null);
    }
  }, [isOpen, post]);

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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
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

      // Generate unique file name
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

  const handleSave = async () => {
    if (!isPublished && !content.trim()) {
      setContentError("Please enter post content");
      return;
    }

    setSaving(true);

    try {
      const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify((() => {
          const payload: any = {
            content,
          };
          if (!isPublished) {
            payload.scheduled_for = scheduledFor;
            payload.media_url = mediaUrl;
          }
          return payload;
        })()),
      });

      const data = await response.json();

      if (response.ok) {
        if (onSuccess) onSuccess();
        onClose();
        toast.success("Post updated successfully");
        setSaveError(null);
      } else {
        setSaveError(data.error || "Failed to update post");
      }
    } catch (error) {
      console.error("Save error:", error);
      setSaveError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleLibraryUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const isValidImage = file.type.startsWith("image/") || 
                        file.type.includes("heic") || 
                        file.type.includes("heif") ||
                        file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
    
    if (!isValidImage) {
      setLibraryUploadError("Please select a supported image file (JPG, PNG, GIF, WEBP, HEIC, HEIF)");
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setLibraryUploadError("Image must be less than 5MB");
      return;
    }

    setLibraryUploading(true);
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
        setLibraryUploadError("Failed to process the image. This may be due to an unsupported camera format.");
        return;
      }

      // Generate unique file name
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

      // Select the uploaded image and close library
      setMediaUrl(publicUrl);
      setLibraryUploadError(null);
      await fetchMediaLibrary();
      setShowMediaLibrary(false);
    } catch (error) {
      console.error("Library upload error:", error);
      if (error instanceof Error) {
        setLibraryUploadError(`Failed to upload image: ${error.message}`);
      } else {
        setLibraryUploadError("Failed to upload image. Please try again or try a different image format.");
      }
    }
    setLibraryUploading(false);
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
        toast.success("Post deleted");
      } else {
        toast.error(data.error || "Failed to delete post");
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete post. Please try again.");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="h-[100dvh] sm:h-auto sm:max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="p-6 border-b border-border sticky top-0 bg-surface z-10">
          <DialogTitle className="text-xl font-heading">Edit Post</DialogTitle>
          <p className="text-sm text-text-secondary mt-1">
            {post.campaign?.name || (post.is_quick_post ? "Quick Post" : "Individual Post")}
          </p>
          <div className="flex items-center gap-2">
            {(selectedPlatforms.length ? selectedPlatforms : (post.platform ? [post.platform] : [])).map((p) => (
              <PlatformBadge key={`hdr-${p}`} platform={p} size="md" showLabel={false} />
            ))}
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {saveError && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-3">
              {saveError}
            </div>
          )}
          {/* Post Status Warning */}
          {isPublished && (
            <div className="bg-warning/10 border border-warning/20 rounded-medium p-4">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Published Post</p>
                  <p className="text-sm text-text-secondary mt-1">
                    Text content cannot be edited after publishing. You can still update the image.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Post Editor (Image left, Text right) */}
          <div>
            <label className="block text-sm font-medium mb-3">Post</label>
            <div className="grid grid-cols-1 md:grid-cols-3 md:gap-4">
              {/* Image column */}
              <div className="w-full md:col-span-1">
                <div className="w-full aspect-square rounded-medium overflow-hidden bg-gray-100 flex items-center justify-center relative">
                  {mediaUrl ? (
                    <Image src={mediaUrl} alt="Post media" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-text-secondary" />
                  )}
                </div>
                {!isPublished && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={uploading}
                    onClick={() => document.getElementById('edit-image-upload')?.click()}
                  >
                    {!uploading && (
                      <>
                        <ImageIcon className="w-4 h-4 mr-2" />
                        {mediaUrl ? 'Replace Image' : 'Upload Image'}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { fetchMediaLibrary(); setShowMediaLibrary(true); }}
                  >
                    Media Library
                  </Button>
                  {mediaUrl && (
                    <Button variant="outline" size="sm" onClick={() => setMediaUrl(null)}>Remove</Button>
                  )}
                </div>
                )}
                <input
                  type="file"
                  id="edit-image-upload"
                  accept="image/*,.heic,.heif"
                  onChange={(e) => { setUploadError(null); handleImageUpload(e); }}
                  className="hidden"
                  disabled={uploading || isPublished}
                />
                {uploadError && (
                  <div className="mt-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                    {uploadError}
                  </div>
                )}
              </div>
              {/* Text column */}
              <div className="md:col-span-2 mt-4 md:mt-0">
                <label className="block text-xs font-medium mb-1">Post Content</label>
                <textarea
                  value={content}
                  onChange={(e) => { setContent(e.target.value); if (e.target.value.trim()) setContentError(null); }}
                  placeholder="Enter your post content..."
                  className={`min-h-[180px] border border-input rounded-md px-3 py-2 ${isPublished ? 'opacity-60 cursor-not-allowed' : ''}`}
                  maxLength={500}
                  disabled={isPublished}
                />
                <p className="text-xs text-text-secondary mt-1">{content.length}/500 characters</p>
                {contentError && (
                  <div className="mt-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                    {contentError}
                  </div>
                )}
                {isPublished && (
                  <p className="text-[11px] text-text-secondary mt-1">Text is read-only for published posts.</p>
                )}
              </div>
            </div>
          </div>

          {/* Platform display moved to header */}

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
                  className="border border-input rounded-md px-3 py-2"
                  min={new Date().toISOString().split('T')[0]}
                  disabled={isPublished}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Time</label>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="border border-input rounded-md px-3 py-2"
                  disabled={isPublished}
                />
              </div>
            </div>
            {isPublished && (
              <p className="text-xs text-text-secondary mt-1">Schedule cannot be changed for published posts.</p>
            )}
          </div>
        </div>

        {/* Media Library Modal */}
        {showMediaLibrary && (
          <Dialog open={showMediaLibrary} onOpenChange={setShowMediaLibrary}>
            <DialogContent aria-describedby={undefined} className="max-w-4xl p-0 overflow-hidden">
              <DialogHeader className="sticky top-0 bg-surface border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-lg">Select from Media Library</DialogTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      loading={libraryUploading}
                      onClick={() => document.getElementById('edit-library-upload')?.click()}
                    >
                      {!libraryUploading && (<><ImageIcon className="w-4 h-4 mr-2" /> Upload</>)}
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <input
                type="file"
                id="edit-library-upload"
                accept="image/*,.heic,.heif"
                onChange={(e) => { setLibraryUploadError(null); handleLibraryUpload(e); }}
                className="hidden"
                disabled={libraryUploading}
              />
              <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
                {libraryUploadError && (
                  <div className="mb-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                    {libraryUploadError}
                  </div>
                )}
                {mediaLibraryImages.length > 0 ? (
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                    {mediaLibraryImages.map((image) => (
                      <button
                        key={image.id}
                        onClick={() => { setMediaUrl(image.file_url || image.url); setShowMediaLibrary(false); }}
                        className="aspect-square rounded-medium overflow-hidden border-2 border-transparent hover:border-primary transition-colors relative"
                      >
                        <Image src={image.file_url || image.url} alt={image.alt_text || ''} fill sizes="160px" className="object-cover" />
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

        {/* Footer */}
        <div className="p-6 border-t border-border sticky bottom-0 bg-surface z-10">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-md px-3 py-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Post
            </button>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
                Cancel
              </Button>
              <Button onClick={handleSave} loading={saving} disabled={deleting || (!isPublished && !content.trim())}>
                {!saving && <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <DialogContent aria-describedby={undefined} className="max-w-md">
              <DialogHeader>
                <DialogTitle>Confirm Deletion</DialogTitle>
              </DialogHeader>
              <p className="text-text-secondary">
                Are you sure you want to delete this post? This action cannot be undone.
              </p>
            <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} loading={deleting}>
                  {!deleting && <Trash2 className="w-4 h-4" />}
                  Delete
                </Button>
            </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
