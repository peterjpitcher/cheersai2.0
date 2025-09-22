"use client";

import { useState, useEffect } from "react";
import { toast } from 'sonner';
import { 
  Save, Image as ImageIcon,
  Trash2, AlertCircle,
  CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PlatformBadge from "@/components/ui/platform-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
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
  // removed inline library upload; using standard image selection modal
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [imageModalDefaultTab, setImageModalDefaultTab] = useState<'library'|'upload'|'default'>('library');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isPublished = post?.status === 'published';
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [preflightStatus, setPreflightStatus] = useState<{ overall: 'pass'|'warn'|'fail'; findings: { level: string; code: string; message: string }[] } | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [showPreflightDetails, setShowPreflightDetails] = useState(false)

  const isCampaignManaged = Boolean(post?.campaign && !post?.is_quick_post);
  const isReadOnly = isPublished;

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

  useEffect(() => {
    if (!isOpen) return
    const platform = (post.platform || post.platforms?.[0] || selectedPlatforms[0] || 'facebook') as string
    if (!content?.trim()) { setPreflightStatus(null); return }
    let ignore = false
    setPreflightLoading(true)
    fetch('/api/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: content, platform }) })
      .then(r => r.json())
      .then(j => { if (!ignore) setPreflightStatus(j.data || j) })
      .catch(() => { if (!ignore) setPreflightStatus(null) })
      .finally(() => { if (!ignore) setPreflightLoading(false) })
    return () => { ignore = true }
  }, [isOpen, content, selectedPlatforms, post.platform, post.platforms])

  const currentPlatform = (post.platform || post.platforms?.[0] || selectedPlatforms[0] || 'facebook') as string

  function renderPreflightChecklist() {
    const findings = preflightStatus?.findings || []
    const codes = new Set(findings.map(f => f.code))
    const items: { label: string; status: 'ok'|'warn'|'fail' }[] = []
    // Universal checks
    items.push({ label: 'No banned phrases', status: codes.has('banned_phrase') ? 'fail' : 'ok' })
    items.push({ label: 'No excessive capitalisation', status: codes.has('caps') ? 'warn' : 'ok' })
    items.push({ label: 'Limited links (≤ 2)', status: codes.has('too_many_links') ? 'warn' : 'ok' })
    items.push({ label: 'No emoji spam', status: codes.has('emoji_spam') ? 'warn' : 'ok' })
    // Platform specific
    // Twitter checks removed
    if (currentPlatform === 'instagram_business') {
      items.push({ label: 'Avoid links in caption', status: codes.has('instagram_links') ? 'warn' : 'ok' })
    }

    const iconFor = (s: 'ok'|'warn'|'fail') => s === 'ok' ? (
      <CheckCircle className="size-4 text-green-600" />
    ) : s === 'warn' ? (
      <AlertTriangle className="size-4 text-amber-600" />
    ) : (
      <XCircle className="size-4 text-red-600" />
    )

    return (
      <ul className="mt-2 space-y-1">
        {items.map((it, idx) => (
          <li key={idx} className="flex items-center gap-2 text-sm">
            {iconFor(it.status)}
            <span>{it.label}</span>
          </li>
        ))}
      </ul>
    )
  }




  const handleSave = async () => {
    if (isPublished) {
      return;
    }

    if (!content.trim()) {
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
          const payload: { content: string; scheduled_for?: string; media_url?: string | null; platforms?: string[] } = {
            content,
          };
          if (!isPublished) {
            payload.scheduled_for = scheduledFor;
            payload.media_url = mediaUrl;
            if (selectedPlatforms.length > 0) {
              payload.platforms = selectedPlatforms;
            }
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

  // inline library upload removed; using ImageSelectionModal for library selection + upload

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
      <DialogContent aria-describedby={undefined} className="h-dvh overflow-hidden p-0 sm:h-auto sm:max-w-3xl">
        <DialogHeader className="sticky top-0 z-10 border-b border-border bg-surface p-6">
          <DialogTitle className="font-heading text-xl">Edit Post</DialogTitle>
          <p className="mt-1 text-sm text-text-secondary">
            {post.campaign?.name || (post.is_quick_post ? "Quick Post" : "Individual Post")}
          </p>
          <div className="flex items-center gap-2">
            {(selectedPlatforms.length ? selectedPlatforms : (post.platform ? [post.platform] : [])).map((p) => (
              <PlatformBadge key={`hdr-${p}`} platform={p} size="md" showLabel={false} />
            ))}
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {saveError && (
            <div className="rounded-medium border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              {saveError}
            </div>
          )}
          {/* Post Status Warning */}
          {(isPublished || isCampaignManaged) && (
            <div className="rounded-medium border border-warning/20 bg-warning/10 p-4">
              <div className="flex gap-3">
                <AlertCircle className="size-5 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-medium">
                    {isPublished ? "Published Post" : "Campaign-managed Post"}
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    {isPublished
                      ? "Text content cannot be edited after publishing. You can still update the image."
                      : "This post is linked to a campaign. Updates here will overwrite the campaign copy."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Post Editor (Image left, Text right) */}
          <div>
            <p className="mb-3 block text-sm font-medium">Post</p>
            <div className="flex flex-col md:flex-row md:gap-4">
              {/* Image column (33%) */}
              <div className="w-full md:max-w-[33%] md:shrink-0 md:basis-1/3">
                <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-medium bg-gray-100">
                  {mediaUrl ? (
                    <Image src={mediaUrl} alt="Post media" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                  ) : (
                    <ImageIcon className="size-8 text-text-secondary" />
                  )}
                </div>
                {(!isReadOnly) && (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setImageModalDefaultTab('upload'); setShowMediaLibrary(true); }}
                  >
                    <ImageIcon className="mr-2 size-4" />
                    {mediaUrl ? 'Replace Image' : 'Upload Image'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setImageModalDefaultTab('library'); setShowMediaLibrary(true); }}
                  >
                    Media Library
                  </Button>
                  {mediaUrl && (
                    <Button variant="outline" size="sm" onClick={() => setMediaUrl(null)}>Remove</Button>
                  )}
                </div>
                )}
                {/* Direct upload handled via ImageSelectionModal upload tab */}
                {/* Errors handled within ImageSelectionModal */}
              </div>
              {/* Text column (67%) */}
              <div className="mt-4 md:mt-0 md:min-w-0 md:basis-2/3">
                <label htmlFor="post-content" className="mb-1 block text-xs font-medium">Post Content</label>
                <textarea
                  id="post-content"
                  value={content}
                  onChange={(e) => { setContent(e.target.value); if (e.target.value.trim()) setContentError(null); }}
                  placeholder="Enter your post content..."
                  className={`min-h-[180px] w-full rounded-md border border-input px-3 py-2 ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                  maxLength={500}
                  disabled={isReadOnly}
                />
                <p className="mt-1 text-xs text-text-secondary">{content.length}/500 characters</p>
                {contentError && (
                  <div className="mt-2 rounded-medium border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                    {contentError}
                  </div>
                )}
                {isReadOnly && (
                  <p className="mt-1 text-[11px] text-text-secondary">
                    Text is read-only for published posts.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Platform display moved to header */}

          {/* Schedule Settings */}
          <div>
            {/* Preflight Panel */}
            {preflightStatus && (
              <div className={`mb-4 rounded-md border p-3 text-sm ${preflightStatus.overall === 'fail' ? 'border-destructive text-destructive' : preflightStatus.overall === 'warn' ? 'border-amber-400 text-amber-600' : 'border-green-400 text-green-700'}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">Preflight: {preflightStatus.overall.toUpperCase()}</div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs hover:underline"
                    onClick={() => setShowPreflightDetails(v => !v)}
                  >
                    {showPreflightDetails ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} Details
                  </button>
                </div>
                {preflightLoading && <div className="mt-1 text-xs">Rechecking…</div>}
                {showPreflightDetails && (
                  <div className="mt-2">
                    {renderPreflightChecklist()}
                  </div>
                )}
              </div>
            )}
            <p className="mb-3 block text-sm font-medium">Scheduled Time</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="scheduled-date" className="mb-1 block text-xs font-medium">Date</label>
                <input
                  id="scheduled-date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="rounded-md border border-input px-3 py-2"
                  min={new Date().toISOString().split('T')[0]}
                  disabled={isReadOnly}
                />
              </div>
              <div>
                <label htmlFor="scheduled-time" className="mb-1 block text-xs font-medium">Time</label>
                <input
                  id="scheduled-time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="rounded-md border border-input px-3 py-2"
                  disabled={isReadOnly}
                />
              </div>
            </div>
            {(!isReadOnly) && (
              <div className="mt-2">
                <Button variant="secondary" size="sm" loading={suggesting} onClick={async () => {
                  try {
                    setSuggesting(true)
                    const platform = (post.platform || post.platforms?.[0] || selectedPlatforms[0] || 'facebook') as string
                    const res = await fetch(`/api/scheduling/suggest?platform=${encodeURIComponent(platform)}`)
                    const json = await res.json()
                    const s = json.data?.suggestions?.[0] || json.suggestions?.[0]
                    if (s) {
                      // Build next date matching suggested weekday/hour
                      const now = new Date()
                      const target = new Date(now)
                      const dayDiff = (s.weekday - now.getDay() + 7) % 7 || 7
                      target.setDate(now.getDate() + dayDiff)
                      target.setHours(s.hour, 0, 0, 0)
                      setScheduledDate(target.toISOString().split('T')[0])
                      setScheduledTime(target.toTimeString().slice(0,5))
                      toast.success('Filled best time to post')
                    } else {
                      toast.message('No suggestion available yet')
                    }
                  } catch {}
                  setSuggesting(false)
                }}>Suggest time</Button>
              </div>
            )}
            {isPublished && (
              <p className="mt-1 text-xs text-text-secondary">Schedule cannot be changed for published posts.</p>
            )}
          </div>
        </div>

        {/* Media Library Modal (standard with upload) */}
        {showMediaLibrary && (
          <ImageSelectionModal
            isOpen={showMediaLibrary}
            onClose={() => setShowMediaLibrary(false)}
            onSelect={(url) => { setMediaUrl(url); setShowMediaLibrary(false); }}
            currentImageUrl={mediaUrl}
            defaultTab={imageModalDefaultTab}
          />
        )}

        {/* Footer */}
        <div className="sticky bottom-0 z-10 border-t border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-red-600 hover:bg-red-50"
            >
              <Trash2 className="size-4" />
              Delete Post
            </button>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
                Cancel
              </Button>
              <Button onClick={handleSave} loading={saving} disabled={isPublished || deleting || (!content.trim())}>
                {!saving && <Save className="size-4" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <DialogContent aria-describedby={undefined} className="max-w-md p-0">
              <DialogHeader className="px-6 py-4">
                <DialogTitle>Confirm Deletion</DialogTitle>
              </DialogHeader>
              <div className="px-6 pb-6">
                <p className="mb-4 text-sm text-text-secondary">
                  Are you sure you want to delete this post? This action cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleDelete} loading={deleting}>
                    {!deleting && <Trash2 className="size-4" />}
                    Delete
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
