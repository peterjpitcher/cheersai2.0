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
  const [assetLoadNonce, setAssetLoadNonce] = useState(0);
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
    setAssetsError(null);
    let cancelled = false;
    getMediaAssetsForPicker()
      .then((result) => { if (!cancelled) setAssets(result); })
      .catch(() => { if (!cancelled) setAssetsError('Failed to load images'); })
      .finally(() => { if (!cancelled) setAssetsLoading(false); });
    return () => { cancelled = true; };
  }, [open, assetLoadNonce]);

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
      router.push('/tournaments');
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
        className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--c-card)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--sh-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--c-ink)' }}
          >
            Tournament Settings
          </h2>
          <button onClick={onClose} aria-label="Close settings">
            <X className="h-5 w-5" style={{ color: 'var(--c-ink-3)' }} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              House Rules{' '}
              <span style={{ color: 'var(--c-ink-3)' }}>({houseRulesText.length}/200)</span>
            </label>
            <textarea
              value={houseRulesText}
              onChange={(e) => setHouseRulesText(e.target.value.slice(0, 200))}
              className="w-full px-3 py-2 text-sm h-20 resize-none"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
              maxLength={200}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Post Template{' '}
              <span style={{ color: 'var(--c-ink-3)' }}>({postTemplate.length}/500)</span>
            </label>
            <textarea
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value.slice(0, 500))}
              className="w-full px-3 py-2 text-sm h-32 resize-none mono"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
              maxLength={500}
              placeholder="Placeholders: {team_a}, {team_b}, {date}, {time}, {group_round}, {house_rules}, {booking_url}"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Post Lead Time
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={postLeadHours}
                onChange={(e) =>
                  setPostLeadHours(Math.max(1, Math.min(168, parseInt(e.target.value) || 24)))
                }
                className="w-20 px-3 py-2 text-sm"
                style={{
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--c-line)',
                  color: 'var(--c-ink)',
                }}
                min={1}
                max={168}
              />
              <span
                className="text-sm"
                style={{ color: 'var(--c-ink-3)' }}
              >
                hours before kick-off
              </span>
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--c-ink)' }}
            >
              Platforms
            </label>
            <div className="flex gap-4">
              {(['instagram', 'facebook'] as const).map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--c-ink-2)' }}
                >
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="rounded"
                    style={{ borderColor: 'var(--c-line-2)' }}
                  />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--c-ink)' }}
            >
              Base Images
            </label>
            <p
              className="text-xs mb-3"
              style={{ color: 'var(--c-ink-3)' }}
            >
              Select a square (1:1) and story (9:16) image used as the background for generated fixture posts.
            </p>
            {assetsLoading ? (
              <div
                className="flex items-center gap-2 text-sm py-4"
                style={{ color: 'var(--c-ink-3)' }}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading images...
              </div>
            ) : assetsError ? (
              <div
                className="flex items-center gap-2 text-sm py-4"
                style={{ color: 'var(--c-claret)' }}
              >
                <ImageIcon className="h-4 w-4" />
                {assetsError}
                <button
                  type="button"
                  onClick={() => {
                    assetsLoaded.current = false;
                    setAssetLoadNonce((value) => value + 1);
                  }}
                  className="text-xs underline ml-1"
                >
                  Retry
                </button>
              </div>
            ) : assets.length === 0 ? (
              <div
                className="flex items-center gap-2 text-sm py-4"
                style={{ color: 'var(--c-ink-3)' }}
              >
                <ImageIcon className="h-4 w-4" />
                No images in library. Upload images in the Library first.
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--c-ink-3)' }}
                  >
                    Square (1:1)
                  </span>
                  <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
                    {assets
                      .filter((a) => a.aspectClass === 'square')
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setSquareImageId(asset.id)}
                          className="relative flex-shrink-0 h-16 w-16 overflow-hidden transition-colors"
                          style={{
                            borderRadius: 'var(--r-md)',
                            border: `2px solid ${
                              squareImageId === asset.id
                                ? 'var(--c-orange)'
                                : 'transparent'
                            }`,
                          }}
                          title={asset.fileName}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.previewUrl}
                            alt={asset.fileName}
                            className="h-full w-full object-cover"
                          />
                          {squareImageId === asset.id && (
                            <div
                              className="absolute inset-0 flex items-center justify-center"
                              style={{ backgroundColor: 'var(--c-orange-tint)', opacity: 0.7 }}
                            >
                              <Check className="h-5 w-5" style={{ color: 'var(--c-orange)' }} />
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--c-ink-3)' }}
                  >
                    Story (9:16)
                  </span>
                  <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
                    {assets
                      .filter((a) => a.aspectClass === 'story')
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setStoryImageId(asset.id)}
                          className="relative flex-shrink-0 h-20 w-12 overflow-hidden transition-colors"
                          style={{
                            borderRadius: 'var(--r-md)',
                            border: `2px solid ${
                              storyImageId === asset.id
                                ? 'var(--c-orange)'
                                : 'transparent'
                            }`,
                          }}
                          title={asset.fileName}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.previewUrl}
                            alt={asset.fileName}
                            className="h-full w-full object-cover"
                          />
                          {storyImageId === asset.id && (
                            <div
                              className="absolute inset-0 flex items-center justify-center"
                              style={{ backgroundColor: 'var(--c-orange-tint)', opacity: 0.7 }}
                            >
                              <Check className="h-5 w-5" style={{ color: 'var(--c-orange)' }} />
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
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--c-ink)' }}
            >
              Status
            </label>
            <div className="flex gap-2">
              {(['draft', 'active', 'archived'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  disabled={tournament.status === s || saving}
                  className="px-3 py-1.5 text-sm disabled:opacity-50 transition-colors"
                  style={{
                    borderRadius: 'var(--r-md)',
                    backgroundColor: tournament.status === s
                      ? 'var(--c-orange)'
                      : 'var(--c-paper-2)',
                    color: tournament.status === s
                      ? 'var(--c-card)'
                      : 'var(--c-ink-3)',
                  }}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--c-ink-3)' }}
            >
              Lead time changes apply to future generation only.
            </p>
          </div>
        </div>

        {/* API Feed Section */}
        <div
          className="pt-4 mt-4"
          style={{ borderTop: '1px solid var(--c-line)' }}
        >
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--c-ink)' }}
          >
            API Feed
          </label>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--c-ink-3)' }}
          >
            Enable a public JSON feed so your brand website can display fixture data.
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: feedApiKey
                    ? 'var(--c-status-posted-bg)'
                    : 'var(--c-paper-2)',
                  color: feedApiKey
                    ? 'var(--c-status-posted-fg)'
                    : 'var(--c-ink-3)',
                }}
              >
                {feedApiKey ? 'Enabled' : 'Disabled'}
              </span>
            </div>

            {feedApiKey && (
              <>
                <div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--c-ink-3)' }}
                  >
                    API Key
                  </span>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={feedKeyVisible ? feedApiKey : '••••••••••••••••••••••••••••••••'}
                      className="flex-1 px-3 py-1.5 text-xs mono"
                      style={{
                        borderRadius: 'var(--r-md)',
                        border: '1px solid var(--c-line)',
                        backgroundColor: 'var(--c-paper)',
                        color: 'var(--c-ink-2)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setFeedKeyVisible(!feedKeyVisible)}
                      className="p-1.5 transition-colors"
                      style={{ color: 'var(--c-ink-3)' }}
                      title={feedKeyVisible ? 'Hide' : 'Reveal'}
                    >
                      {feedKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(feedApiKey, 'key')}
                      className="p-1.5 transition-colors"
                      style={{ color: 'var(--c-ink-3)' }}
                      title="Copy key"
                    >
                      {feedCopied === 'key' ? (
                        <Check className="h-3.5 w-3.5" style={{ color: 'var(--c-status-posted-fg)' }} />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--c-ink-3)' }}
                  >
                    Endpoint
                  </span>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/feed/${tournament.id}`}
                      className="flex-1 px-3 py-1.5 text-xs mono"
                      style={{
                        borderRadius: 'var(--r-md)',
                        border: '1px solid var(--c-line)',
                        backgroundColor: 'var(--c-paper)',
                        color: 'var(--c-ink-2)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${window.location.origin}/api/feed/${tournament.id}`, 'url')}
                      className="p-1.5 transition-colors"
                      style={{ color: 'var(--c-ink-3)' }}
                      title="Copy URL"
                    >
                      {feedCopied === 'url' ? (
                        <Check className="h-3.5 w-3.5" style={{ color: 'var(--c-status-posted-fg)' }} />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
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
                    className="inline-flex items-center gap-1 text-xs transition-colors"
                    style={{ color: 'var(--c-ink-3)' }}
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 transition-colors"
                style={{
                  backgroundColor: 'var(--c-orange)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                {feedLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {feedApiKey ? 'Regenerate Key' : 'Enable Feed'}
              </button>
              {feedApiKey && (
                <button
                  type="button"
                  onClick={handleDisableFeedKey}
                  disabled={feedLoading || saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50 transition-colors"
                  style={{
                    backgroundColor: 'var(--c-paper-2)',
                    color: 'var(--c-ink-3)',
                    borderRadius: 'var(--r-md)',
                  }}
                >
                  Disable Feed
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Delete Section */}
        <div
          className="pt-4 mt-4"
          style={{ borderTop: '1px solid var(--c-line)' }}
        >
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--c-claret)' }}
          >
            Delete Tournament
          </label>
          <p
            className="text-xs mb-3"
            style={{ color: 'var(--c-ink-3)' }}
          >
            This will permanently remove all fixtures, generated content, and scheduled posts. Type the tournament name to confirm.
          </p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={tournament.name}
            className="w-full px-3 py-2 text-sm mb-2"
            style={{
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--c-claret-soft)',
              color: 'var(--c-ink)',
            }}
          />
          <button
            onClick={handleDeleteTournament}
            disabled={deleteConfirm !== tournament.name || deleting || saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{
              backgroundColor: 'var(--c-claret)',
              borderRadius: 'var(--r-md)',
            }}
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete Tournament
          </button>
        </div>

        {error && (
          <div
            className="mt-4 p-3 text-sm"
            style={{
              borderRadius: 'var(--r-md)',
              backgroundColor: 'var(--c-claret-soft)',
              color: 'var(--c-claret)',
            }}
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              color: 'var(--c-ink-3)',
              borderRadius: 'var(--r-md)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !postTemplate.trim() || platforms.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{
              backgroundColor: 'var(--c-orange)',
              borderRadius: 'var(--r-md)',
            }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
