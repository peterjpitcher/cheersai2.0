'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, ImageIcon, Check } from 'lucide-react';
import type { Tournament } from '@/types/tournament';
import {
  updateTournament,
  updateTournamentStatus,
  updateTournamentBaseImages,
  getMediaAssetsForPicker,
} from '@/app/actions/tournament';
import type { PickerAsset } from '@/app/actions/tournament';

interface TournamentSettingsModalProps {
  tournament: Tournament;
  open: boolean;
  onClose: () => void;
}

export function TournamentSettingsModal({
  tournament,
  open,
  onClose,
}: TournamentSettingsModalProps) {
  const [name, setName] = useState(tournament.name);
  const [houseRulesText, setHouseRulesText] = useState(tournament.houseRulesText ?? '');
  const [postTemplate, setPostTemplate] = useState(tournament.postTemplate);
  const [postLeadHours, setPostLeadHours] = useState(tournament.postLeadHours);
  const [platforms, setPlatforms] = useState(tournament.platforms);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [squareImageId, setSquareImageId] = useState(tournament.baseImageSquareId);
  const [storyImageId, setStoryImageId] = useState(tournament.baseImageStoryId);
  const [assets, setAssets] = useState<PickerAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const assetsLoaded = useRef(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || assetsLoaded.current) return;
    assetsLoaded.current = true;
    setAssetsLoading(true);
    getMediaAssetsForPicker()
      .then(setAssets)
      .finally(() => setAssetsLoading(false));
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await updateTournament(tournament.id, {
        name,
        houseRulesText: houseRulesText || null,
        postTemplate,
        postLeadHours,
        platforms,
      });
      if (!result.success) {
        setError(result.error ?? 'Failed to save');
        return;
      }

      const imagesChanged =
        squareImageId !== tournament.baseImageSquareId ||
        storyImageId !== tournament.baseImageStoryId;
      if (imagesChanged) {
        const imgResult = await updateTournamentBaseImages(
          tournament.id,
          squareImageId,
          storyImageId,
        );
        if (!imgResult.success) {
          setError(imgResult.error ?? 'Failed to save base images');
          return;
        }
      }

      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: 'draft' | 'active' | 'archived') {
    setSaving(true);
    try {
      await updateTournamentStatus(tournament.id, status);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(platform: 'instagram' | 'facebook') {
    setPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tournament Settings"
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Tournament Settings</h2>
          <button onClick={onClose} aria-label="Close settings">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              House Rules{' '}
              <span className="text-muted-foreground">({houseRulesText.length}/200)</span>
            </label>
            <textarea
              value={houseRulesText}
              onChange={(e) => setHouseRulesText(e.target.value.slice(0, 200))}
              className="w-full rounded-md border px-3 py-2 text-sm h-20 resize-none"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Post Template{' '}
              <span className="text-muted-foreground">({postTemplate.length}/500)</span>
            </label>
            <textarea
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value.slice(0, 500))}
              className="w-full rounded-md border px-3 py-2 text-sm h-32 resize-none font-mono"
              maxLength={500}
              placeholder="Placeholders: {team_a}, {team_b}, {date}, {time}, {group_round}, {house_rules}, {booking_url}"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Post Lead Time</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={postLeadHours}
                onChange={(e) =>
                  setPostLeadHours(Math.max(1, Math.min(168, parseInt(e.target.value) || 24)))
                }
                className="w-20 rounded-md border px-3 py-2 text-sm"
                min={1}
                max={168}
              />
              <span className="text-sm text-muted-foreground">hours before kick-off</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Platforms</label>
            <div className="flex gap-4">
              {(['instagram', 'facebook'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-gray-300"
                  />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Base Images</label>
            <p className="text-xs text-muted-foreground mb-3">
              Select a square (1:1) and story (9:16) image used as the background for generated fixture posts.
            </p>
            {assetsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading images...
              </div>
            ) : assets.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <ImageIcon className="h-4 w-4" />
                No images in library. Upload images in the Library first.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Square (1:1)</span>
                  <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
                    {assets
                      .filter((a) => a.aspectClass === 'square')
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setSquareImageId(asset.id)}
                          className={`relative flex-shrink-0 h-16 w-16 rounded-md overflow-hidden border-2 transition-colors ${
                            squareImageId === asset.id
                              ? 'border-primary'
                              : 'border-transparent hover:border-muted-foreground/30'
                          }`}
                          title={asset.fileName}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.previewUrl}
                            alt={asset.fileName}
                            className="h-full w-full object-cover"
                          />
                          {squareImageId === asset.id && (
                            <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                              <Check className="h-5 w-5 text-primary" />
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Story (9:16)</span>
                  <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
                    {assets
                      .filter((a) => a.aspectClass === 'story')
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setStoryImageId(asset.id)}
                          className={`relative flex-shrink-0 h-20 w-12 rounded-md overflow-hidden border-2 transition-colors ${
                            storyImageId === asset.id
                              ? 'border-primary'
                              : 'border-transparent hover:border-muted-foreground/30'
                          }`}
                          title={asset.fileName}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.previewUrl}
                            alt={asset.fileName}
                            className="h-full w-full object-cover"
                          />
                          {storyImageId === asset.id && (
                            <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                              <Check className="h-5 w-5 text-primary" />
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Status</label>
            <div className="flex gap-2">
              {(['draft', 'active', 'archived'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  disabled={tournament.status === s || saving}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    tournament.status === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  } disabled:opacity-50`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Lead time changes apply to future generation only.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !postTemplate.trim() || platforms.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
