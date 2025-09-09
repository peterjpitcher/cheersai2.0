"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  X, Upload, Image as ImageIcon, Loader2, Check, 
  FolderOpen, RotateCcw
} from "lucide-react";
import { compressImage } from "@/lib/utils/image-compression";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabKey = 'library' | 'upload' | 'default'

interface ImageSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string | null, assetId: string | null) => void;
  currentImageUrl?: string | null;
  defaultImageUrl?: string | null;
  postId?: string;
  platform?: string;
  defaultTab?: TabKey;
}

export default function ImageSelectionModal({
  isOpen,
  onClose,
  onSelect,
  currentImageUrl,
  defaultImageUrl,
  postId,
  platform,
  defaultTab
}: ImageSelectionModalProps) {
  const [mediaLibraryImages, setMediaLibraryImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(currentImageUrl || null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(defaultTab || 'library');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 24;
  const [hasNext, setHasNext] = useState(false);
  const [wmFilter, setWmFilter] = useState<'all'|'with'|'without'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');

  useEffect(() => {
    if (isOpen) {
      setTab(defaultTab || 'library');
      fetchMediaLibrary();
    }
  }, [isOpen, defaultTab, page]);

  const fetchMediaLibrary = async () => {
    setLoading(true);
    const supabase = createClient();
    // Tenant scoping for performance and security
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMediaLibraryImages([]); setHasNext(false); setLoading(false); return; }
    const { data: profile } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    const tenantId = profile?.tenant_id;
    const start = page * pageSize;
    const end = start + pageSize - 1;
    let q = supabase
      .from('media_assets')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(start, end);
    const { data, error } = await q;
    if (!error && data) {
      setMediaLibraryImages(data);
      setHasNext(data.length === pageSize);
    } else {
      setMediaLibraryImages([]);
      setHasNext(false);
    }
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
      // Get user session for tenant_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get tenant_id
      const { data: profile } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!profile?.tenant_id) throw new Error("No tenant found");

      // Compress image
      let compressedBlob;
      try {
        compressedBlob = await compressImage(file);
      } catch (compressionError) {
        console.error("Image compression failed:", compressionError);
        setUploadError("Failed to process the image. This may be due to an unsupported camera format.");
        return;
      }

      // If auto-apply watermark is enabled, send to watermark API and use the result
      let uploadBlob: Blob = compressedBlob;
      let markAsWatermarked = false;
      let wmSettings: any = null;
      try {
        const { data: settings } = await supabase
          .from('watermark_settings')
          .select('*')
          .eq('tenant_id', profile.tenant_id)
          .single();
        wmSettings = settings;
        if (settings?.enabled && settings?.auto_apply) {
          const form = new FormData();
          form.append('image', new File([compressedBlob], file.name, { type: 'image/jpeg' }));
          const res = await fetch('/api/media/watermark', { method: 'POST', body: form });
          if (res.ok) {
            const watermarked = await res.blob();
            uploadBlob = watermarked;
            markAsWatermarked = true;
          }
        }
      } catch (e) {
        console.warn('Auto watermark not applied:', e);
      }
      
      // Upload to Supabase storage - handle HEIC/HEIF conversion
      const originalExt = file.name.split(".").pop()?.toLowerCase();
      const isHEIC = originalExt === "heic" || originalExt === "heif";
      const finalExt = isHEIC ? "jpg" : originalExt;
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/\.(heic|heif)$/i, '.jpg')}`;
      const filePath = `${profile.tenant_id}/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(filePath, uploadBlob, {
          contentType: 'image/jpeg',
          cacheControl: "3600"
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(filePath);

      // Create media_assets record
      const { data: asset, error: assetError } = await supabase
        .from("media_assets")
        .insert({
          tenant_id: profile.tenant_id,
          file_url: publicUrl,
          file_name: file.name,
          file_type: 'image/jpeg',
          file_size: uploadBlob.size,
          storage_path: filePath,
          alt_text: `Image for ${platform || 'post'}`
        ,
          has_watermark: markAsWatermarked,
          watermark_position: markAsWatermarked ? wmSettings?.position : null
        })
        .select()
        .single();

      if (assetError) throw assetError;

      // Add to library and select
      setMediaLibraryImages(prev => [asset, ...prev]);
      setSelectedImage(publicUrl);
      setSelectedAssetId(asset.id);
      setUploadError(null);

    } catch (error) {
      console.error("Upload failed:", error);
      if (error instanceof Error) {
        setUploadError(`Failed to upload image: ${error.message}`);
      } else {
        setUploadError("Failed to upload image. Please try again or try a different image format.");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleImageSelect = (image: any) => {
    setSelectedImage(image.file_url);
    setSelectedAssetId(image.id);
  };

  const handleConfirm = () => {
    onSelect(selectedImage, selectedAssetId);
    onClose();
  };

  const handleUseDefault = () => {
    onSelect(null, null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>Select Image for Post</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-3 px-6">
            <TabsTrigger value="library">
              <FolderOpen className="w-4 h-4 mr-2" />
              Media Library
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="w-4 h-4 mr-2" />
              Upload New
            </TabsTrigger>
            {defaultImageUrl && (
              <TabsTrigger value="default">
                <RotateCcw className="w-4 h-4 mr-2" />
                Use Default
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="library" className="flex-1 overflow-auto px-6 pb-6">
            <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="Search filename or alt text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="border rounded-md px-3 py-2 text-sm w-full md:w-72"
                />
                <select value={wmFilter} onChange={(e)=> setWmFilter(e.target.value as any)} className="h-9 px-2 border rounded-md text-sm">
                  <option value="all">All</option>
                  <option value="with">Watermarked</option>
                  <option value="without">No watermark</option>
                </select>
                <select value={folderFilter} onChange={(e)=> setFolderFilter(e.target.value)} className="h-9 px-2 border rounded-md text-sm">
                  <option value="all">All folders</option>
                  {Array.from(new Set(mediaLibraryImages
                    .map((img:any) => {
                      const path = String(img.storage_path || '');
                      const parts = path.split('/');
                      return parts.length > 1 ? parts.slice(1, -1)[0] || '' : '';
                    })
                    .filter(Boolean)
                  )).map((folder) => (
                    <option key={folder} value={folder}>{folder}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-start md:justify-end gap-2">
                <button
                  className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >Prev</button>
                <span className="text-sm text-text-secondary">Page {page + 1}</span>
                <button
                  className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasNext || loading}
                >Next</button>
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : mediaLibraryImages.length === 0 ? (
              <div className="text-center py-12">
                <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No images in your library</p>
                <p className="text-sm text-gray-500 mt-2">Upload an image to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                {mediaLibraryImages
                  .filter((img:any) => !query || (img.file_name?.toLowerCase().includes(query.toLowerCase()) || img.alt_text?.toLowerCase().includes(query.toLowerCase())))
                  .filter((img:any) => wmFilter === 'all' ? true : (wmFilter === 'with' ? !!img.has_watermark : !img.has_watermark))
                  .filter((img:any) => {
                    if (folderFilter === 'all') return true;
                    const path = String(img.storage_path || '');
                    const parts = path.split('/');
                    const folder = parts.length > 1 ? parts.slice(1, -1)[0] || '' : '';
                    return folder === folderFilter;
                  })
                  .map((image:any) => (
                  <button
                    key={image.id}
                    onClick={() => handleImageSelect(image)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                      selectedImage === image.file_url 
                        ? "border-primary ring-2 ring-primary ring-offset-2" 
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <img
                      src={image.file_url}
                      alt={image.alt_text || image.file_name}
                      className="w-full h-full object-cover"
                    />
                    {selectedImage === image.file_url && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <div className="bg-primary text-white rounded-full p-2">
                          <Check className="w-5 h-5" />
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="flex-1">
            <div className="p-8">
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {uploading ? (
                    <Loader2 className="w-10 h-10 mb-3 text-gray-400 animate-spin" />
                  ) : (
                    <Upload className="w-10 h-10 mb-3 text-gray-400" />
                  )}
                  <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PNG, JPG, GIF, WEBP, HEIC, HEIF (MAX. 5MB)</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,.heic,.heif"
                  onChange={(e) => { setUploadError(null); handleFileUpload(e); }}
                  disabled={uploading}
                />
              </label>
              {uploadError && (
                <div className="mt-4 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-3">
                  {uploadError}
                </div>
              )}

              {selectedImage && (
                <div className="mt-4">
                  <p className="text-sm text-gray-600 mb-2">Preview:</p>
                  <img
                    src={selectedImage}
                    alt="Selected"
                    className="w-32 h-32 object-cover rounded-lg"
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {defaultImageUrl && (
            <TabsContent value="default" className="flex-1">
              <div className="p-8 text-center">
                <p className="text-gray-600 mb-4">Use the campaign's default image:</p>
                <img
                  src={defaultImageUrl}
                  alt="Campaign default"
                  className="w-64 h-64 object-cover rounded-lg mx-auto mb-6"
                />
                <button
                  onClick={handleUseDefault}
                  className="bg-primary text-white rounded-md h-10 px-4 text-sm"
                >
                  Use Default Image
                </button>
              </div>
            </TabsContent>
          )}
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button onClick={onClose} className="text-text-secondary hover:bg-muted rounded-md h-10 px-4 text-sm">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedImage}
            className="bg-primary text-white rounded-md h-10 px-4 text-sm disabled:opacity-50"
          >
            Confirm Selection
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
