"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import { 
  Upload, Image as ImageIcon, X, Search, 
  Loader2, Trash2, Download, CheckCircle
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

  useEffect(() => {
    fetchMedia();
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
      // Validate file type
      if (!file.type.startsWith("image/")) {
        alert(`${file.name} is not an image file`);
        continue;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert(`${file.name} is too large. Maximum size is 5MB`);
        continue;
      }

      // Compress image before upload
      const compressedFile = await compressImage(file);
      
      // Create unique file name
      const fileExt = file.name.split(".").pop();
      const fileName = `${userData.tenant_id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

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

      // Save to database
      const { error: dbError } = await supabase
        .from("media_assets")
        .insert({
          tenant_id: userData.tenant_id,
          file_url: publicUrl,
          file_name: file.name,
          file_type: compressedFile.type,
          file_size: compressedFile.size,
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
            <Link href="/dashboard" className="btn-ghost">
              Back to Dashboard
            </Link>
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
            accept="image/*"
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
              PNG, JPG, GIF up to 5MB
            </p>
          </label>
        </div>

        {/* Search Bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary/50" />
          <input
            type="text"
            placeholder="Search images..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-10"
          />
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
                className="group relative card p-2 hover:shadow-warm"
              >
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
    </div>
  );
}