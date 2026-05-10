'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2, ImageIcon, Check, Copy, Eye, EyeOff, RefreshCw, Code } from 'lucide-react';
import type { Tournament } from '@/types/tournament';
import {
  updateTournament,
  updateTournamentStatus,
  updateTournamentBaseImages,
  getMediaAssetsForPicker,
  deleteTournament,
  regenerateFeedApiKey,
  disableFeedApiKey,
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
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const assetsLoaded = useRef(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const [feedApiKey, setFeedApiKey] = useState(tournament.feedApiKey);
  const [feedKeyVisible, setFeedKeyVisible] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCopied, setFeedCopied] = useState<'key' | 'url' | 'snippet' | null>(null);

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
    if (!open) return;
    setName(tournament.name);
    setHouseRulesText(tournament.houseRulesText ?? '');
    setPostTemplate(tournament.postTemplate);
    setPostLeadHours(tournament.postLeadHours);
    setPlatforms(tournament.platforms);
    setSquareImageId(tournament.baseImageSquareId);
    setStoryImageId(tournament.baseImageStoryId);
    setFeedApiKey(tournament.feedApiKey);
    setFeedKeyVisible(false);
    setFeedCopied(null);
    setError(null);
    setDeleteConfirm('');
    assetsLoaded.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tournament.id]);

  useEffect(() => {
    if (!open || assetsLoaded.current) return;
    assetsLoaded.current = true;
    setAssetsLoading(true);
    let cancelled = false;
    getMediaAssetsForPicker()
      .then((result) => { if (!cancelled) setAssets(result); })
      .catch(() => { if (!cancelled) setAssetsError('Failed to load images'); })
      .finally(() => { if (!cancelled) setAssetsLoading(false); });
    return () => { cancelled = true; };
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
    setError(null);
    try {
      const result = await updateTournamentStatus(tournament.id, status);
      if (!result.success) {
        setError(result.error ?? 'Failed to change status');
        return;
      }
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

  async function handleGenerateFeedKey() {
    if (feedApiKey) {
      const confirmed = window.confirm(
        'Regenerating the API key will immediately invalidate the current key. Any brand sites using the old key will stop working. Continue?',
      );
      if (!confirmed) return;
    }
    setFeedLoading(true);
    setError(null);
    try {
      const result = await regenerateFeedApiKey(tournament.id);
      if (result.success) {
        setFeedApiKey(result.apiKey);
        setFeedKeyVisible(true);
      } else {
        setError(result.error);
      }
    } finally {
      setFeedLoading(false);
    }
  }

  async function handleDisableFeedKey() {
    const confirmed = window.confirm(
      'Disabling the API feed will immediately stop serving data to any brand sites using this key. Continue?',
    );
    if (!confirmed) return;
    setFeedLoading(true);
    setError(null);
    try {
      const result = await disableFeedApiKey(tournament.id);
      if (result.success) {
        setFeedApiKey(null);
        setFeedKeyVisible(false);
      } else {
        setError(result.error ?? 'Failed to disable feed');
      }
    } finally {
      setFeedLoading(false);
    }
  }

  function copyToClipboard(text: string, label: 'key' | 'url' | 'snippet') {
    navigator.clipboard.writeText(text);
    setFeedCopied(label);
    setTimeout(() => setFeedCopied(null), 2000);
  }

  async function handleDeleteTournament() {
    if (deleteConfirm !== tournament.name) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteTournament(tournament.id);
      if (!result.success) {
        setError(result.error ?? 'Failed to delete tournament');
        return;
      }
      router.push('/dashboard/tournaments');
    } finally {
      setDeleting(false);
    }
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
            ) : assetsError ? (
              <div className="flex items-center gap-2 text-sm text-red-600 py-4">
                <ImageIcon className="h-4 w-4" />
                {assetsError}
                <button
                  type="button"
                  onClick={() => { assetsLoaded.current = false; setAssetsError(null); }}
                  className="text-xs underline ml-1"
                >
                  Retry
                </button>
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

        <div className="border-t pt-4 mt-4">
          <label className="block text-sm font-medium mb-2">API Feed</label>
          <p className="text-xs text-muted-foreground mb-3">
            Enable a public JSON feed so your brand website can display fixture data.
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                feedApiKey
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {feedApiKey ? 'Enabled' : 'Disabled'}
              </span>
            </div>

            {feedApiKey && (
              <>
                <div>
                  <span className="text-xs font-medium text-muted-foreground">API Key</span>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={feedKeyVisible ? feedApiKey : '••••••••••••••••••••••••••••••••'}
                      className="flex-1 rounded-md border bg-muted/30 px-3 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setFeedKeyVisible(!feedKeyVisible)}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                      title={feedKeyVisible ? 'Hide' : 'Reveal'}
                    >
                      {feedKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(feedApiKey, 'key')}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                      title="Copy key"
                    >
                      {feedCopied === 'key' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-medium text-muted-foreground">Endpoint</span>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/feed/${tournament.id}`}
                      className="flex-1 rounded-md border bg-muted/30 px-3 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${window.location.origin}/api/feed/${tournament.id}`, 'url')}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                      title="Copy URL"
                    >
                      {feedCopied === 'url' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = `fetch('${typeof window !== 'undefined' ? window.location.origin : ''}/api/feed/${tournament.id}', {\n  headers: { 'x-api-key': '${feedApiKey}' }\n})\n  .then(res => res.json())\n  .then(data => console.log(data.fixtures));`;
                      copyToClipboard(snippet, 'snippet');
                    }}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Code className="h-3 w-3" />
                    {feedCopied === 'snippet' ? 'Copied!' : 'Copy code snippet'}
                  </button>
                </div>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGenerateFeedKey}
                disabled={feedLoading || saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {feedLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {feedApiKey ? 'Regenerate Key' : 'Enable Feed'}
              </button>
              {feedApiKey && (
                <button
                  type="button"
                  onClick={handleDisableFeedKey}
                  disabled={feedLoading || saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                >
                  Disable Feed
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="border-t pt-4 mt-4">
          <label className="block text-sm font-medium mb-2 text-red-600">Delete Tournament</label>
          <p className="text-xs text-muted-foreground mb-3">
            This will permanently remove all fixtures, generated content, and scheduled posts. Type the tournament name to confirm.
          </p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={tournament.name}
            className="w-full rounded-md border border-red-200 px-3 py-2 text-sm mb-2"
          />
          <button
            onClick={handleDeleteTournament}
            disabled={deleteConfirm !== tournament.name || deleting || saving}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete Tournament
          </button>
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
