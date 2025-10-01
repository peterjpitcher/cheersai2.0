"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import NextImage from "next/image";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/utils/image-compression";
import { 
  Upload, Images, Search, 
  Loader2, Trash2, Download
} from "lucide-react";
import { toast } from 'sonner';
import Container from "@/components/layout/container";
import WatermarkAdjuster from "@/components/watermark/watermark-adjuster";
import CropSquareModal from "@/components/media/crop-square-modal";
import { validateWatermarkSettings, type WatermarkSettings } from "@/lib/utils/watermark";
import type { Database } from "@/lib/database.types";

interface MediaAsset {
  id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size?: number;
  created_at: string;
  tags?: string[] | null;
}

type TenantLogo = Database['public']['Tables']['tenant_logos']['Row']

export default function MediaLibraryPage() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettings | null>(null);
  const [adjusterOpen, setAdjusterOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState<{ file: File; preview: string } | null>(null);
  const [logos, setLogos] = useState<TenantLogo[]>([]);
  const [customWatermarkSettings, setCustomWatermarkSettings] = useState<WatermarkSettings | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    fetchMedia();
    fetchWatermarkSettings();
  }, []);

  const fetchMedia = async () => {
    try {
      const res = await fetch('/api/media/list', { cache: 'no-store' });
      if (!res.ok) {
        setMedia([]);
      } else {
        const payload = await res.json();
        const assets = Array.isArray(payload?.data?.assets)
          ? payload.data.assets
          : Array.isArray(payload?.assets)
            ? payload.assets
            : [];
        setMedia(assets);
      }
    } catch {
      setMedia([]);
    } finally {
      setLoading(false);
    }
  };

  // Crop modal handlers for single-image uploads
  const handleCropped = async (blob: Blob) => {
    setCropOpen(false);
    if (!pendingCropFile) return;
    const name = pendingCropFile.name.replace(/\.[^.]+$/, '.jpg');
    if (watermarkSettings?.enabled && logos.length > 0) {
      // Open adjuster with cropped blob
      const previewUrl = URL.createObjectURL(blob);
      setCurrentImage({ file: new File([blob], name, { type: 'image/jpeg' }), preview: previewUrl });
      setCustomWatermarkSettings(watermarkSettings);
      setAdjusterOpen(true);
    } else {
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: 'image/jpeg' }));
      await uploadFiles(dt.files);
    }
    setPendingCropFile(null);
  };

  const handleKeepOriginal = async () => {
    setCropOpen(false);
    if (!pendingCropFile) return;
    toast.message('Using non-square image', { description: 'Some platforms may crop your image in feed.' });
    if (watermarkSettings?.enabled && logos.length > 0) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCurrentImage({ file: pendingCropFile, preview: reader.result as string });
        setCustomWatermarkSettings(watermarkSettings);
        setAdjusterOpen(true);
      };
      reader.readAsDataURL(pendingCropFile);
    } else {
      const dt = new DataTransfer();
      dt.items.add(pendingCropFile);
      await uploadFiles(dt.files);
    }
    setPendingCropFile(null);
  };

  const fetchWatermarkSettings = async () => {
    try {
      const response = await fetch("/api/media/watermark");
      if (response.ok) {
        const json = await response.json();
        const payload = json?.data || json || {};
        const validated = validateWatermarkSettings((payload.settings ?? {}) as Partial<WatermarkSettings>);
        setWatermarkSettings(validated);
        const logoList = Array.isArray(payload.logos) ? (payload.logos as TenantLogo[]) : [];
        setLogos(logoList);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    // If watermark is enabled and we have logos, show adjuster for first image (after optional crop)
    if (watermarkSettings?.enabled && logos.length > 0 && files.length > 0) {
      const file = files[0];
      
      // Validate file type - include HEIC/HEIF formats from camera
      const isValidImage = file.type.startsWith("image/") || 
                          file.type.includes("heic") || 
                          file.type.includes("heif") ||
                          file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
      
      if (!isValidImage) {
        setPageError(`${file.name} is not a supported image file. Supported formats: JPG, PNG, GIF, WEBP, HEIC, HEIF`);
        return;
      }

      // If single file and not square, prompt crop first
      const probe = new window.Image();
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve) => { probe.onload = () => resolve(); probe.src = url; });
      URL.revokeObjectURL(url);
      if (probe.width !== probe.height && files.length === 1) {
        setPendingCropFile(file);
        setCropOpen(true);
        return;
      }
      // Create preview then open adjuster
      const reader = new FileReader();
      reader.onloadend = () => {
        setCurrentImage({ file, preview: reader.result as string });
        setCustomWatermarkSettings(watermarkSettings);
        setAdjusterOpen(true);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Normal upload without adjuster (offer crop if single image and not square)
    if (files.length === 1) {
      const file = files[0];
      const probe = new window.Image();
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve) => { probe.onload = () => resolve(); probe.src = url; });
      URL.revokeObjectURL(url);
      if (probe.width !== probe.height) {
        setPendingCropFile(file);
        setCropOpen(true);
        return;
      }
    }
    await uploadFiles(files);
  };

  const uploadFiles = async (files: FileList, customSettings?: WatermarkSettings | null) => {
    setUploading(true);

    for (const file of Array.from(files)) {
      // Validate file type - include HEIC/HEIF formats from camera
      const isValidImage = file.type.startsWith("image/") || 
                          file.type.includes("heic") || 
                          file.type.includes("heif") ||
                          file.name.match(/\.(heic|heif|jpg|jpeg|png|gif|webp)$/i);
      
      if (!isValidImage) {
        setPageError(`${file.name} is not a supported image file. Supported formats: JPG, PNG, GIF, WEBP, HEIC, HEIF`);
        continue;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setPageError(`${file.name} is too large. Maximum size is 5MB`);
        continue;
      }

      // Compress image before upload
      let compressedFile: Blob;
      try {
        compressedFile = await compressImage(file);
      } catch (compressionError) {
        console.error("Image compression failed:", compressionError);
        setPageError(`Failed to process ${file.name}. This may be due to an unsupported camera format.`);
        continue;
      }
      
      // Ensure square: center-crop if needed (for batch uploads we auto-crop)
      let squareBlob: Blob = compressedFile;
      try {
        const imgUrl = URL.createObjectURL(compressedFile);
        const img = new window.Image();
        await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = imgUrl; });
        URL.revokeObjectURL(imgUrl);
        if (img.width !== img.height) {
          const size = Math.min(img.width, img.height);
          const sx = Math.floor((img.width - size) / 2);
          const sy = Math.floor((img.height - size) / 2);
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          const out: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
          if (out) squareBlob = out;
        }
      } catch {}

      // Prepare final blob (possibly watermarked)
      let finalBlob: Blob = squareBlob;
      let finalName = file.name;
      // Handle HEIC/HEIF conversion for naming
      const originalExt = file.name.split(".").pop()?.toLowerCase();
      const isHEIC = originalExt === "heic" || originalExt === "heif";
      if (isHEIC) {
        finalName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
      }

      // Apply watermark only if user confirmed settings via adjuster
      const settings = customSettings ?? null; // do not auto-apply without user choice
      
      if (settings?.enabled && logos.length > 0) {
        try {
          // Create FormData for watermark API
          const formData = new FormData();
          formData.append('image', compressedFile, finalName);
          formData.append('position', settings.position || 'bottom-right');
          if (settings.opacity != null) formData.append('opacity', String(settings.opacity))
          if (settings.size_percent != null) formData.append('size_percent', String(settings.size_percent))
          if (settings.margin_pixels != null) formData.append('margin_pixels', String(settings.margin_pixels))
          
          // Call watermark API
          const watermarkResponse = await fetch('/api/media/watermark', {
            method: 'POST',
            body: formData,
          });
          
          if (watermarkResponse.ok) {
            // Get watermarked image
            const watermarkedBlob = await watermarkResponse.blob();
            finalBlob = watermarkedBlob;
            // ensure filename has correct ext
            const wmType = watermarkedBlob.type || 'image/jpeg';
            const extFromType = wmType.includes('png') ? 'png' : 'jpg';
            finalName = finalName.replace(/\.[^.]+$/, `.${extFromType}`);
          }
        } catch (error) {
          console.error('Watermark application failed:', error);
          // Continue with original upload
        }
      }

      // Upload to server endpoint
      const uploadForm = new FormData();
      // Append with filename so server receives a File
      uploadForm.append('image', finalBlob, finalName);
      const res = await fetch('/api/media/upload', { method: 'POST', body: uploadForm });
      if (!res.ok) {
        console.error('Upload error:', await res.text());
        setPageError(`Failed to upload ${file.name}`);
        continue;
      }
      const payload = await res.json();
      const asset = (payload?.data?.asset ?? payload?.asset) as MediaAsset | undefined;
      if (!asset) {
        console.warn('Upload succeeded but no asset payload returned', payload);
      } else {
        // Optimistically add to list
        setMedia(prev => [asset, ...prev]);
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
      setPageError("Failed to delete file");
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

  const handleRename = async (id: string, name: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from('media_assets')
      .update({ file_name: name })
      .eq('id', id);
    if (error) {
      toast.error('Failed to rename image');
    } else {
      setMedia(prev => prev.map(a => a.id === id ? { ...a, file_name: name } : a));
    }
  };

  const handleTagAdd = async (id: string, tag: string) => {
    const a = media.find(x => x.id === id);
    if (!a) return;
    const nextTags = Array.from(new Set([...(a.tags || []), tag]));
    const supabase = createClient();
    const { error } = await supabase
      .from('media_assets')
      .update({ tags: nextTags })
      .eq('id', id);
    if (error) {
      toast.error('Failed to add tag');
    } else {
      setMedia(prev => prev.map(x => x.id === id ? { ...x, tags: nextTags } : x));
    }
  };

  const handleTagRemove = async (id: string, tag: string) => {
    const a = media.find(x => x.id === id);
    if (!a) return;
    const nextTags = (a.tags || []).filter(t => t !== tag);
    const supabase = createClient();
    const { error } = await supabase
      .from('media_assets')
      .update({ tags: nextTags })
      .eq('id', id);
    if (error) {
      toast.error('Failed to remove tag');
    } else {
      setMedia(prev => prev.map(x => x.id === id ? { ...x, tags: nextTags } : x));
    }
  };

  const filteredMedia = media.filter(asset =>
    asset.file_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Grouping helpers
  const byTag = new Map<string, MediaAsset[]>();
  for (const a of filteredMedia) {
    const tagList = (a.tags && a.tags.length ? a.tags : []) as string[];
    if (tagList.length === 0) {
      const arr = byTag.get('__uncategorised__') || [];
      arr.push(a); byTag.set('__uncategorised__', arr);
    } else {
      for (const t of tagList) {
        const key = t.trim();
        const arr = byTag.get(key) || [];
        arr.push(a); byTag.set(key, arr);
      }
    }
  }
  const tagNames = Array.from(byTag.keys()).filter(k => k !== '__uncategorised__').sort((a,b)=>a.localeCompare(b));
  const uncategorised = byTag.get('__uncategorised__') || [];

  const recentlyUploaded = [...media]
    .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 4);

  const handleWatermarkApply = async (settings: WatermarkSettings) => {
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

  // Bulk watermarking removed: watermark is offered during each upload

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="pb-page-pb pt-page-pt">
        {pageError && (
          <div className="mb-6 rounded-medium border border-destructive/30 bg-destructive/10 p-3 text-destructive">
            {pageError}
          </div>
        )}
        {/* Upload Area */}
        <div
          className={`relative mb-8 rounded-large border-2 border-dashed p-8 transition-all ${
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
            className="flex cursor-pointer flex-col items-center"
          >
            {uploading ? (
              <Loader2 className="mb-4 size-12 animate-spin text-primary" />
            ) : (
              <Upload className="mb-4 size-12 text-primary" />
            )}
            <p className="mb-2 text-lg font-medium">
              {uploading ? "Uploading..." : "Drop images here or click to upload"}
            </p>
            <p className="text-sm text-text-secondary">
              PNG, JPG, GIF, WEBP, HEIC, HEIF up to 5MB
            </p>
          </label>
        </div>

        {/* Watermark controls are handled per-upload via the adjuster */}

        {/* Search */}
        <div className="mb-6 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-secondary/50" />
            <input
              type="text"
              placeholder="Search images..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 pl-10 text-sm"
            />
          </div>
        </div>

        {/* Media Grid with sections */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : filteredMedia.length === 0 ? (
          <div className="py-12 text-center">
            <Images className="mx-auto mb-4 size-16 text-text-secondary/30" />
            <p className="text-text-secondary">
              {searchQuery ? "No images found" : "No images uploaded yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Recently uploaded (only when not searching) */}
            {(!searchQuery && recentlyUploaded.length > 0) && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text-secondary">Recently uploaded</h2>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {recentlyUploaded.map((asset) => (
                    <MediaCard key={`recent-${asset.id}`} asset={asset} onDelete={handleDelete} onRename={handleRename} onTagAdd={handleTagAdd} onTagRemove={handleTagRemove} />
                  ))}
                </div>
              </section>
            )}

            {/* Tagged sections */}
            {tagNames.map((tag) => (
              <TagSection key={tag} title={tag} assets={byTag.get(tag) || []} onDelete={handleDelete} onRename={handleRename} onTagAdd={handleTagAdd} onTagRemove={handleTagRemove} />
            ))}

            {/* Uncategorised at bottom */}
            {uncategorised.length > 0 && (
              <TagSection key="__uncategorised__" title="Uncategorised" assets={uncategorised} onDelete={handleDelete} onRename={handleRename} onTagAdd={handleTagAdd} onTagRemove={handleTagRemove} defaultCollapsed={false} />
            )}
          </div>
        )}
        </Container>
      </main>

      {/* Watermark Adjuster Modal */}
      {currentImage && logos.length > 0 && (
        <WatermarkAdjuster
          isOpen={adjusterOpen}
          onClose={async () => {
            // User chose not to apply watermark; proceed to upload the image
            setAdjusterOpen(false);
            if (currentImage) {
              const fileList = new DataTransfer();
              fileList.items.add(currentImage.file);
              await uploadFiles(fileList.files);
            }
            setCurrentImage(null);
          }}
          imageUrl={currentImage.preview}
          logoUrl={logos[0]?.file_url || ''}
          initialSettings={customWatermarkSettings || validateWatermarkSettings(watermarkSettings || {})}
          onApply={handleWatermarkApply}
        />
      )}
      {/* Crop to square modal for single-image uploads */}
      {pendingCropFile && (
        <CropSquareModal
          open={cropOpen}
          onClose={() => setCropOpen(false)}
          file={pendingCropFile}
          onCropped={async (blob) => { await handleCropped(blob) }}
          onKeepOriginal={async () => { await handleKeepOriginal() }}
        />
      )}
    </div>
  );
}

// Inline card component with rename + tag editing
function MediaCard({ asset, onDelete, onRename, onTagAdd, onTagRemove }: {
  asset: MediaAsset;
  onDelete: (a: MediaAsset) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onTagAdd: (id: string, tag: string) => Promise<void>;
  onTagRemove: (id: string, tag: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.file_name);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editing]);

  const save = async () => {
    if (!editing) return;
    const next = name.trim();
    if (!next || next === asset.file_name) { setEditing(false); return; }
    setSaving(true);
    await onRename(asset.id, next);
    setSaving(false);
    setEditing(false);
  };

  const handleKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.currentTarget.blur(); await save(); }
    if (e.key === 'Escape') { setName(asset.file_name); setEditing(false); }
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t) return;
    await onTagAdd(asset.id, t);
    setTagInput('');
  };

  return (
    <div className="group relative rounded-lg border bg-card p-2 text-card-foreground shadow-sm hover:shadow-warm">
      <div className="relative mb-2 aspect-square overflow-hidden rounded-soft bg-gray-100">
        <NextImage
          src={asset.file_url}
          alt={asset.file_name || 'Media asset'}
          fill
          sizes="(max-width: 768px) 50vw, 200px"
          className="object-cover"
        />
      </div>
      <div className="px-1">
        {!editing ? (
          <button className="w-full truncate text-left text-sm font-medium hover:underline" onClick={() => setEditing(true)} title="Click to rename">
            {asset.file_name}
          </button>
        ) : (
          <input
            value={name}
            onChange={(e)=>setName(e.target.value)}
            onBlur={save}
            onKeyDown={handleKey}
            className="w-full rounded-md border border-input px-2 py-1 text-sm"
            ref={renameInputRef}
          />
        )}
        {/* Tags */}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {(asset.tags || []).map((t) => (
            <span key={`${asset.id}-${t}`} className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">
              {t}
              <button className="text-text-secondary hover:text-primary" onClick={() => onTagRemove(asset.id, t)} title="Remove tag">×</button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e)=>setTagInput(e.target.value)}
            onKeyDown={(e)=>{ if (e.key==='Enter') { e.preventDefault(); addTag(); } }}
            placeholder="Add tag"
            className="rounded border px-1.5 py-0.5 text-[10px]"
          />
          <button onClick={addTag} className="rounded border bg-background px-1.5 py-0.5 text-[10px]">Add</button>
        </div>
      </div>
      {/* Actions */}
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex gap-1">
          <button onClick={() => window.open(asset.file_url, '_blank')} className="rounded-soft bg-white/90 p-2 backdrop-blur transition-colors hover:bg-white" title="Open in new tab">
            <Download className="size-4" />
          </button>
          <button onClick={() => onDelete(asset)} className="rounded-soft bg-white/90 p-2 text-error backdrop-blur transition-colors hover:bg-white" title="Delete">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {saving && <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/40"><Loader2 className="size-5 animate-spin"/></div>}
    </div>
  );
}

function TagSection({ title, assets, onDelete, onRename, onTagAdd, onTagRemove, defaultCollapsed = false }: {
  title: string;
  assets: MediaAsset[];
  onDelete: (a: MediaAsset) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onTagAdd: (id: string, tag: string) => Promise<void>;
  onTagRemove: (id: string, tag: string) => Promise<void>;
  defaultCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  if (!assets || assets.length === 0) return null;
  return (
    <section>
      <button className="mb-2 flex w-full items-center justify-between text-left" onClick={() => setOpen(o=>!o)}>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-text-secondary">{assets.length} image{assets.length!==1?'s':''} {open?'▾':'▸'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {assets.map((asset) => (
            <MediaCard key={`${title}-${asset.id}`} asset={asset} onDelete={onDelete} onRename={onRename} onTagAdd={onTagAdd} onTagRemove={onTagRemove} />
          ))}
        </div>
      )}
    </section>
  );
}
