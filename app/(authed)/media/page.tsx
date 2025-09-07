"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import { 
  Upload, Image as ImageIcon, X, Search, 
  Loader2, Trash2, Download, CheckCircle, Droplets, Settings,
  CheckSquare, Square
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WatermarkAdjuster from "@/components/watermark/watermark-adjuster";
import { validateWatermarkSettings, getDefaultWatermarkSettings } from "@/lib/utils/watermark";

interface MediaAsset {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export default function MediaLibraryPage() {
  const router = useRouter();
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [watermarkSettings, setWatermarkSettings] = useState<any>(null);
  const [applyWatermark, setApplyWatermark] = useState(false);
  const [adjusterOpen, setAdjusterOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState<{ file: File; preview: string } | null>(null);
  const [logos, setLogos] = useState<any[]>([]);
  const [customWatermarkSettings, setCustomWatermarkSettings] = useState<any>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [applyingBulkWatermark, setApplyingBulkWatermark] = useState(false);

  useEffect(() => {
    fetchMedia();
    fetchWatermarkSettings();
  }, []);

  const fetchMedia = async () => {
    const supabase = createClient();
    
    // Get user's tenant_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      router.push("/onboarding");
      return;
    }

    // Fetch media assets
    const { data, error } = await supabase
      .from("media_assets")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setMedia(data);
    }
    setLoading(false);
  };

  const fetchWatermarkSettings = async () => {
    try {
      const response = await fetch("/api/media/watermark");
      if (response.ok) {
        const data = await response.json();
        setWatermarkSettings(data.settings);
        setLogos(data.logos || []);
        setApplyWatermark(data.settings?.auto_apply || false);
      }
    } catch (error) {
      console.error("Failed to fetch watermark settings:", error);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    // If watermark is enabled and we have logos, show adjuster for first image
    if (applyWatermark && watermarkSettings?.enabled && logos.length > 0 && files.length > 0) {
      const file = files[0];
      
      // Validate file type - include HEIC/HEIF formats from camera
      const isValidImage = file.type.startsWith("image/") || 
                          file.type.includes("heic") || 
                          file.type.includes("heif") ||
                          file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
      
      if (!isValidImage) {
        alert(`${file.name} is not a supported image file. Supported formats: JPG, PNG, GIF, WEBP, HEIC, HEIF`);
        return;
      }

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setCurrentImage({
          file: file,
          preview: reader.result as string
        });
        setCustomWatermarkSettings(watermarkSettings);
        setAdjusterOpen(true);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Normal upload without adjuster
    await uploadFiles(files);
  };

  const uploadFiles = async (files: FileList, customSettings?: any) => {
    setUploading(true);
    const supabase = createClient();
    
    // Get user's tenant_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    for (const file of Array.from(files)) {
      // Validate file type - include HEIC/HEIF formats from camera
      const isValidImage = file.type.startsWith("image/") || 
                          file.type.includes("heic") || 
                          file.type.includes("heif") ||
                          file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
      
      if (!isValidImage) {
        alert(`${file.name} is not a supported image file. Supported formats: JPG, PNG, GIF, WEBP, HEIC, HEIF`);
        continue;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert(`${file.name} is too large. Maximum size is 5MB`);
        continue;
      }

      // Compress image before upload
      let compressedFile;
      try {
        compressedFile = await compressImage(file);
      } catch (compressionError) {
        console.error("Image compression failed:", compressionError);
        alert(`Failed to process ${file.name}. This may be due to an unsupported camera format.`);
        continue;
      }
      
      // Create unique file name - handle HEIC/HEIF conversion
      const originalExt = file.name.split(".").pop()?.toLowerCase();
      const isHEIC = originalExt === "heic" || originalExt === "heif";
      const finalExt = isHEIC ? "jpg" : originalExt;
      const fileName = `${userData.tenant_id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${finalExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, compressedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        alert(`Failed to upload ${file.name}`);
        continue;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);

      // Apply watermark if enabled
      let finalUrl = publicUrl;
      let hasWatermark = false;
      const settings = customSettings || watermarkSettings;
      
      if (applyWatermark && settings?.enabled && logos.length > 0) {
        try {
          // Create FormData for watermark API
          const formData = new FormData();
          formData.append('image', compressedFile);
          formData.append('position', settings.position || 'bottom-right');
          
          // Call watermark API
          const watermarkResponse = await fetch('/api/media/watermark', {
            method: 'POST',
            body: formData,
          });
          
          if (watermarkResponse.ok) {
            // Get watermarked image
            const watermarkedBlob = await watermarkResponse.blob();
            
            // Upload watermarked version
            const watermarkedFileName = `${userData.tenant_id}/watermarked/${Date.now()}-${Math.random().toString(36).substring(7)}.${finalExt}`;
            
            const { data: watermarkedUpload, error: watermarkUploadError } = await supabase.storage
              .from("media")
              .upload(watermarkedFileName, watermarkedBlob, {
                cacheControl: "3600",
                upsert: false,
              });
              
            if (!watermarkUploadError) {
              // Use watermarked URL
              const { data: { publicUrl: watermarkedUrl } } = supabase.storage
                .from("media")
                .getPublicUrl(watermarkedFileName);
              finalUrl = watermarkedUrl;
              hasWatermark = true;
              
              // Delete original upload
              await supabase.storage.from("media").remove([fileName]);
            }
          }
        } catch (error) {
          console.error('Watermark application failed:', error);
          // Continue with original upload
        }
      }

      // Save to database
      const { error: dbError } = await supabase
        .from("media_assets")
        .insert({
          tenant_id: userData.tenant_id,
          file_url: finalUrl,
          file_name: file.name,
          file_type: compressedFile.type,
          file_size: compressedFile.size,
          has_watermark: hasWatermark,
          watermark_position: hasWatermark ? settings?.position : null,
        });

      if (dbError) {
        console.error("Database error:", dbError);
        // Try to delete uploaded file
        await supabase.storage.from("media").remove([fileName]);
      }
    }

    setUploading(false);
    fetchMedia(); // Refresh the list
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!confirm(`Delete ${asset.file_name}?`)) return;

    const supabase = createClient();
    
    // Delete from database
    const { error: dbError } = await supabase
      .from("media_assets")
      .delete()
      .eq("id", asset.id);

    if (dbError) {
      alert("Failed to delete file");
      return;
    }

    // Extract file path from URL for storage deletion
    const urlParts = asset.file_url.split("/");
    const filePath = urlParts.slice(-2).join("/");
    
    // Delete from storage
    await supabase.storage
      .from("media")
      .remove([filePath]);

    fetchMedia(); // Refresh the list
  };

  const filteredMedia = media.filter(asset =>
    asset.file_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleWatermarkApply = async (settings: any) => {
    if (!currentImage) return;
    
    // Save custom settings and upload with watermark
    setCustomWatermarkSettings(settings);
    const fileList = new DataTransfer();
    fileList.items.add(currentImage.file);
    await uploadFiles(fileList.files, settings);
    
    // Reset state
    setCurrentImage(null);
    setAdjusterOpen(false);
  };

  const toggleSelection = (assetId: string) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(assetId)) {
      newSelection.delete(assetId);
    } else {
      newSelection.add(assetId);
    }
    setSelectedFiles(newSelection);
  };

  const selectAll = () => {
    if (selectedFiles.size === filteredMedia.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredMedia.map(m => m.id)));
    }
  };

  const applyBulkWatermark = async () => {
    if (selectedFiles.size === 0) {
      alert("Please select at least one image");
      return;
    }

    if (!watermarkSettings?.enabled || !logos.length) {
      alert("Please configure watermark settings first");
      router.push("/settings/logo");
      return;
    }

    setApplyingBulkWatermark(true);

    try {
      const response = await fetch("/api/media/batch-watermark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetIds: Array.from(selectedFiles),
          settings: watermarkSettings
        }),
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully applied watermarks to ${result.processed} images`);
        setSelectedFiles(new Set());
        setSelectMode(false);
        fetchMedia(); // Refresh the list
      } else {
        alert("Failed to apply watermarks. Please try again.");
      }
    } catch (error) {
      console.error("Error applying bulk watermarks:", error);
      alert("An error occurred. Please try again.");
    } finally {
      setApplyingBulkWatermark(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">Media Library</h1>
              <p className="text-sm text-text-secondary">
                {media.length} {media.length === 1 ? "image" : "images"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectMode && selectedFiles.size > 0 && (
                <button
                  onClick={applyBulkWatermark}
                  disabled={applyingBulkWatermark}
              className="bg-primary text-white rounded-md h-10 px-4 text-sm flex items-center gap-2"
                >
                  {applyingBulkWatermark ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <Droplets className="w-4 h-4" />
                      Apply Watermark ({selectedFiles.size})
                    </>
                  )}
                </button>
              )}
              <button
                onClick={() => {
                  setSelectMode(!selectMode);
                  setSelectedFiles(new Set());
                }}
                className="text-text-secondary hover:bg-muted rounded-md px-3 py-2"
              >
                {selectMode ? "Cancel Selection" : "Select Images"}
              </button>
              <Link href="/dashboard" className="text-text-secondary hover:bg-muted rounded-md px-3 py-2">
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Upload Area */}
        <div
          className={`relative border-2 border-dashed rounded-large p-8 mb-8 transition-all ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="file-upload"
            multiple
            accept="image/*,.heic,.heif"
            onChange={handleFileInput}
            className="hidden"
          />
          <label
            htmlFor="file-upload"
            className="flex flex-col items-center cursor-pointer"
          >
            {uploading ? (
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
            ) : (
              <Upload className="w-12 h-12 text-primary mb-4" />
            )}
            <p className="text-lg font-medium mb-2">
              {uploading ? "Uploading..." : "Drop images here or click to upload"}
            </p>
            <p className="text-sm text-text-secondary">
              PNG, JPG, GIF, WEBP, HEIC, HEIF up to 5MB
            </p>
          </label>
        </div>

        {/* Watermark Toggle */}
        {watermarkSettings?.enabled && (
          <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-medium">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Droplets className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-medium">Apply Watermark</p>
                  <p className="text-sm text-text-secondary">
                    Add your logo to uploaded images
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setApplyWatermark(!applyWatermark)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    applyWatermark ? 'bg-primary' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      applyWatermark ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                {applyWatermark && (
                  <Link 
                    href="/settings/logo" 
                    className="text-sm text-primary hover:underline flex items-center"
                  >
                    <Settings className="w-4 h-4 mr-1" />
                    Settings
                  </Link>
                )}
              </div>
            </div>
            {!logos?.length && (
              <Link href="/settings/logo" className="text-sm text-primary hover:underline mt-2 inline-block">
                Upload a logo first →
              </Link>
            )}
            {applyWatermark && logos?.length > 0 && (
              <p className="text-xs text-text-secondary mt-3">
                💡 Tip: You'll be able to adjust the watermark position for each image before uploading
              </p>
            )}
          </div>
        )}

        {/* Search Bar and Select All */}
        <div className="flex items-center gap-4 mb-6">
          {selectMode && (
            <button
              onClick={selectAll}
              className="text-text-secondary hover:bg-muted rounded-md px-3 py-2 flex items-center gap-2"
            >
              {selectedFiles.size === filteredMedia.length ? (
                <>
                  <CheckSquare className="w-4 h-4" />
                  Deselect All
                </>
              ) : (
                <>
                  <Square className="w-4 h-4" />
                  Select All
                </>
              )}
            </button>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary/50" />
            <input
              type="text"
              placeholder="Search images..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 border border-input rounded-md h-10 px-3 text-sm bg-background"
            />
          </div>
        </div>

        {/* Media Grid */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredMedia.length === 0 ? (
          <div className="text-center py-12">
            <ImageIcon className="w-16 h-16 text-text-secondary/30 mx-auto mb-4" />
            <p className="text-text-secondary">
              {searchQuery ? "No images found" : "No images uploaded yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredMedia.map((asset) => (
              <div
                key={asset.id}
                className="group relative rounded-lg border bg-card text-card-foreground shadow-sm p-2 hover:shadow-warm"
              >
                {/* Selection checkbox */}
                {selectMode && (
                  <button
                    onClick={() => toggleSelection(asset.id)}
                    className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur rounded-medium p-1.5 shadow-sm"
                  >
                    {selectedFiles.has(asset.id) ? (
                      <CheckSquare className="w-5 h-5 text-primary" />
                    ) : (
                      <Square className="w-5 h-5 text-gray-600" />
                    )}
                  </button>
                )}
                {/* Image */}
                <div className="aspect-square rounded-soft overflow-hidden bg-gray-100 mb-2">
                  <img
                    src={asset.file_url}
                    alt={asset.file_name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>

                {/* Info */}
                <div className="px-1">
                  <p className="text-sm font-medium truncate">{asset.file_name}</p>
                  <p className="text-xs text-text-secondary">
                    {formatFileSize(asset.file_size)}
                  </p>
                </div>

                {/* Actions */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex gap-1">
                    <button
                      onClick={() => window.open(asset.file_url, "_blank")}
                      className="bg-white/90 backdrop-blur p-2 rounded-soft hover:bg-white transition-colors"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(asset)}
                      className="bg-white/90 backdrop-blur p-2 rounded-soft hover:bg-white transition-colors text-error"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Watermark Adjuster Modal */}
      {currentImage && logos.length > 0 && (
        <WatermarkAdjuster
          isOpen={adjusterOpen}
          onClose={() => {
            setAdjusterOpen(false);
            setCurrentImage(null);
          }}
          imageUrl={currentImage.preview}
          logoUrl={logos[0]?.file_url || ''}
          initialSettings={customWatermarkSettings || validateWatermarkSettings(watermarkSettings || {})}
          onApply={handleWatermarkApply}
        />
      )}
    </div>
  );
}
