"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  X, Upload, Image as ImageIcon, Loader2, Check, 
  FolderOpen, RotateCcw
} from "lucide-react";
import { compressImage } from "@/lib/utils/image-compression";
import CropSquareModal from "@/components/media/crop-square-modal";
import { WatermarkPrompt } from "@/components/media/watermark-prompt";
import WatermarkAdjuster from "@/components/watermark/watermark-adjuster";
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
  const [cropOpen, setCropOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [wmPromptOpen, setWmPromptOpen] = useState(false)
  const [wmAdjustOpen, setWmAdjustOpen] = useState(false)
  const [wmDefaults, setWmDefaults] = useState<any>(null)
  const [hasActiveLogo, setHasActiveLogo] = useState(false)
  const [activeLogoUrl, setActiveLogoUrl] = useState<string | null>(null)
  const [wmDeclined, setWmDeclined] = useState(false)
  const [tab, setTab] = useState<TabKey>(defaultTab || 'library');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 24;
  const [hasNext, setHasNext] = useState(false);
  const [wmFilter, setWmFilter] = useState<'all'|'with'|'without'>('all');
  // Folders removed; use tags instead

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
    const q = supabase
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
    setWmDeclined(false)

    // Validate file type - include HEIC/HEIF formats from camera
    const isValidImage = file.type.startsWith("image/") || 
                        file.type.includes("heic") || 
                        file.type.includes("heif") ||
                        file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
    
    if (!isValidImage) {
      setUploadError("Please select a supported image file (JPG, PNG, GIF, WEBP, HEIC, HEIF)");
      return;
    }

    // Relax pre-compression size limit to accommodate modern phone photos.
    // We compress before uploading, so allow up to 25MB source files.
    if (file.size > 25 * 1024 * 1024) {
      setUploadError("Image is too large (max 25MB source). Please choose a smaller image.");
      return;
    }

    // Offer square crop first if needed
    const img = new Image()
    const fileUrl = URL.createObjectURL(file)
    await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = fileUrl })
    URL.revokeObjectURL(fileUrl)
    if (img.width !== img.height) {
      setPendingFile(file)
      setCropOpen(true)
      // Will continue in crop handlers
      return
    }

    await proceedUpload(file)
  };

  async function proceedUpload(initialFile: File | Blob, opts?: { skipWatermark?: boolean }) {
    setUploading(true)
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
        compressedBlob = await compressImage(initialFile as File);
      } catch (compressionError) {
        console.error("Image compression failed:", compressionError);
        setUploadError("Failed to process the image. This may be due to an unsupported camera format.");
        return;
      }
      // Decide watermark offer if logo present
      let uploadBlob: Blob = compressedBlob
      let markAsWatermarked = false
      let wmSettings: any = null
      try {
        const res = await fetch('/api/media/watermark')
        if (res.ok) {
          const json = await res.json()
          const logos = json.data?.logos || json.logos || []
          const active = (logos || []).find((l: any) => l.is_active)
          setHasActiveLogo(!!active)
          setActiveLogoUrl(active?.file_url || null)
          const defaults = json.data?.settings || json.settings
          setWmDefaults(defaults)
          wmSettings = defaults
          if (active) {
            if (defaults?.auto_apply) {
              const f = new FormData()
              f.append('image', new File([compressedBlob], (initialFile as any).name || 'image.jpg', { type: 'image/jpeg' }))
              const wmRes = await fetch('/api/media/watermark', { method: 'POST', body: f })
              if (wmRes.ok) {
                const wmBlob = await wmRes.blob()
                uploadBlob = wmBlob
                markAsWatermarked = true
              }
            } else if (!opts?.skipWatermark && !wmDeclined) {
              // Ask user if they want watermark; open prompt then adjuster
              setPendingFile(new File([compressedBlob], (initialFile as any).name || 'image.jpg', { type: 'image/jpeg' }))
              setWmPromptOpen(true)
              setUploading(false)
              return
            }
          }
        }
      } catch {}
      
      // Upload to Supabase storage - handle HEIC/HEIF conversion
      const originalExt = ((initialFile as any).name || 'image.jpg').split(".").pop()?.toLowerCase();
      const isHEIC = originalExt === "heic" || originalExt === "heif";
      const finalExt = isHEIC ? "jpg" : originalExt;
      const baseName = ((initialFile as any).name || 'image.jpg')
      const fileName = `${Date.now()}-${baseName.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/\.(heic|heif)$/i, '.jpg')}`;
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
          file_name: (initialFile as any).name || 'image.jpg',
          file_type: 'image/jpeg',
          file_size: uploadBlob.size,
          storage_path: filePath,
          alt_text: `Image for ${platform || 'post'}`
        ,
          has_watermark: markAsWatermarked,
          watermark_position: markAsWatermarked ? (wmSettings?.position || 'bottom-right') : null
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

  // Crop handlers
  const handleCropped = async (blob: Blob) => {
    setWmDeclined(false)
    await proceedUpload(blob)
  }

  const handleKeepOriginal = async () => {
    setWmDeclined(false)
    if (pendingFile) await proceedUpload(pendingFile)
  }

  const handleWmConfirm = () => {
    setWmPromptOpen(false)
    setWmAdjustOpen(true)
  }

  const handleApplyWm = async (adjusted: any) => {
    if (!pendingFile) return
    try {
      const form = new FormData()
      form.append('image', new File([pendingFile], pendingFile.name || 'image.jpg', { type: 'image/jpeg' }))
      if (adjusted?.position) form.append('position', adjusted.position)
      if (adjusted?.opacity) form.append('opacity', String(adjusted.opacity))
      if (adjusted?.size_percent) form.append('size_percent', String(adjusted.size_percent))
      if (adjusted?.margin_pixels) form.append('margin_pixels', String(adjusted.margin_pixels))
      const res = await fetch('/api/media/watermark', { method: 'POST', body: form })
      if (res.ok) {
        const wmBlob = await res.blob()
        await proceedUpload(wmBlob)
      } else {
        await proceedUpload(pendingFile)
      }
    } catch {
      await proceedUpload(pendingFile)
    } finally {
      setWmAdjustOpen(false)
      setPendingFile(null)
    }
  }

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
      <DialogContent aria-describedby={undefined} className="flex max-h-[80vh] max-w-4xl flex-col p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>Select Image for Post</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3 px-6">
            <TabsTrigger value="library">
              <FolderOpen className="mr-2 size-4" />
              Media Library
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="mr-2 size-4" />
              Upload New
            </TabsTrigger>
            {defaultImageUrl && (
              <TabsTrigger value="default">
                <RotateCcw className="mr-2 size-4" />
                Use Default
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="library" className="flex-1 overflow-auto px-6 pb-6">
            <div className="mb-3 grid grid-cols-1 items-center gap-3 md:grid-cols-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search filename or alt text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm md:w-72"
                />
                <select value={wmFilter} onChange={(e)=> setWmFilter(e.target.value as any)} className="h-9 rounded-md border px-2 text-sm">
                  <option value="all">All</option>
                  <option value="with">Watermarked</option>
                  <option value="without">No watermark</option>
                </select>
              </div>
              <div className="flex items-center justify-start gap-2 md:justify-end">
                <button
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >Prev</button>
                <span className="text-sm text-text-secondary">Page {page + 1}</span>
                <button
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasNext || loading}
                >Next</button>
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-8 animate-spin text-primary" />
              </div>
            ) : mediaLibraryImages.length === 0 ? (
              <div className="py-12 text-center">
                <ImageIcon className="mx-auto mb-4 size-12 text-gray-400" />
                <p className="text-gray-600">No images in your library</p>
                <p className="mt-2 text-sm text-gray-500">Upload an image to get started</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Recently uploaded (top 4) */}
                {(() => {
                  const recent = [...mediaLibraryImages].sort((a:any,b:any)=> new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0,4);
                  if (recent.length === 0) return null;
                  return (
                    <div>
                      <div className="mb-2 text-sm font-semibold text-text-secondary">Recently uploaded</div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                        {recent.map((image:any) => (
                          <button key={`recent-${image.id}`} onClick={() => handleImageSelect(image)} className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${selectedImage===image.file_url? 'border-primary ring-2 ring-primary ring-offset-2':'border-gray-200 hover:border-gray-400'}`}>
                            <img src={image.file_url} alt={image.alt_text || image.file_name} className="size-full object-cover" />
                            {selectedImage===image.file_url && (<div className="absolute inset-0 bg-primary/20" />)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {(() => {
                  // Group by tags (uncategorised last)
                  const imgs = mediaLibraryImages
                    .filter((img:any) => !query || (img.file_name?.toLowerCase().includes(query.toLowerCase()) || img.alt_text?.toLowerCase().includes(query.toLowerCase())))
                    .filter((img:any) => wmFilter === 'all' ? true : (wmFilter === 'with' ? !!img.has_watermark : !img.has_watermark));
                  const map = new Map<string, any[]>();
                  for (const i of imgs) {
                    const tags = Array.isArray(i.tags) && i.tags.length ? i.tags : ['Uncategorised'];
                    for (const t of tags) {
                      const key = t || 'Uncategorised';
                      const arr = map.get(key) || [];
                      arr.push(i); map.set(key, arr);
                    }
                  }
                  const names = Array.from(map.keys()).filter(n=>n!=='Uncategorised').sort((a,b)=>a.localeCompare(b));
                  const sections = [...names, 'Uncategorised'];
                  return (
                    <div className="space-y-6">
                      {sections.map((name) => {
                        const list = map.get(name) || [];
                        if (list.length === 0) return null;
                        return (
                          <div key={`sec-${name}`}>
                            <div className="mb-2 text-sm font-semibold">{name}</div>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                              {list.map((image:any) => (
                                <button key={image.id} onClick={() => handleImageSelect(image)} className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${selectedImage===image.file_url? 'border-primary ring-2 ring-primary ring-offset-2':'border-gray-200 hover:border-gray-400'}`}>
                                  <img src={image.file_url} alt={image.alt_text || image.file_name} className="size-full object-cover" />
                                  {selectedImage===image.file_url && (<div className="absolute inset-0 bg-primary/20" />)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="flex-1">
            <div className="p-8">
              <label className="flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100">
                <div className="flex flex-col items-center justify-center pb-6 pt-5">
                  {uploading ? (
                    <Loader2 className="mb-3 size-10 animate-spin text-gray-400" />
                  ) : (
                    <Upload className="mb-3 size-10 text-gray-400" />
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
                <div className="mt-4 rounded-medium border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                  {uploadError}
                </div>
              )}

              {selectedImage && (
                <div className="mt-4">
                  <p className="mb-2 text-sm text-gray-600">Preview:</p>
                  <img
                    src={selectedImage}
                    alt="Selected"
                    className="size-32 rounded-lg object-cover"
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {defaultImageUrl && (
            <TabsContent value="default" className="flex-1">
              <div className="p-8 text-center">
                <p className="mb-4 text-gray-600">Use the campaign's default image:</p>
                <img
                  src={defaultImageUrl}
                  alt="Campaign default"
                  className="mx-auto mb-6 size-64 rounded-lg object-cover"
                />
                <button
                  onClick={handleUseDefault}
                  className="h-10 rounded-md bg-primary px-4 text-sm text-white"
                >
                  Use Default Image
                </button>
              </div>
            </TabsContent>
          )}
        </Tabs>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <button onClick={onClose} className="h-10 rounded-md px-4 text-sm text-text-secondary hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedImage}
            className="h-10 rounded-md bg-primary px-4 text-sm text-white disabled:opacity-50"
          >
            Confirm Selection
          </button>
        </div>
      </DialogContent>

      {/* Crop to square modal */}
      {pendingFile && (
        <CropSquareModal
          open={cropOpen}
          onClose={() => setCropOpen(false)}
          file={pendingFile}
          onCropped={handleCropped}
          onKeepOriginal={handleKeepOriginal}
        />
      )}

      {/* Watermark prompt and adjuster */}
      {hasActiveLogo && (
        <WatermarkPrompt
          open={wmPromptOpen}
          onClose={async () => { setWmPromptOpen(false); setWmDeclined(true); if (pendingFile) { await proceedUpload(pendingFile, { skipWatermark: true }); setPendingFile(null) } }}
          onConfirm={handleWmConfirm}
          logoPresent={hasActiveLogo}
        />
      )}
      {wmAdjustOpen && wmDefaults && pendingFile && (
        <WatermarkAdjuster
          isOpen={wmAdjustOpen}
          onClose={() => setWmAdjustOpen(false)}
          imageUrl={URL.createObjectURL(pendingFile)}
          logoUrl={activeLogoUrl || ''}
          initialSettings={{ position: wmDefaults.position || 'bottom-right', opacity: wmDefaults.opacity || 0.8, size_percent: wmDefaults.size_percent || 15, margin_pixels: wmDefaults.margin_pixels || 20 }}
          onApply={handleApplyWm}
        />
      )}
    </Dialog>
  );
}
