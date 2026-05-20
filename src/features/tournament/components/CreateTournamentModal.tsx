'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { createTournament } from '@/app/actions/tournament';

interface CreateTournamentModalProps {
  open: boolean;
  onClose: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function CreateTournamentModal({ open, onClose }: CreateTournamentModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [postTemplate, setPostTemplate] = useState(
    '⚽ {team_a} vs {team_b}\n📅 {date} at {time}\n\n{house_rules}\n\n{booking_url}',
  );
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'facebook']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleNameChange(value: string) {
    setName(value);
    if (!slugManual) setSlug(slugify(value));
  }

  function togglePlatform(platform: string) {
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const result = await createTournament({
        name,
        slug,
        postTemplate,
        platforms,
        postLeadHours: 24,
      });
      if (!result.success) {
        setError(result.error ?? 'Failed to create tournament');
      } else if (result.tournamentId) {
        onClose();
        router.push(`/tournaments/${result.tournamentId}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const canCreate = name.trim().length > 0 && slug.length > 0 && postTemplate.trim().length > 0 && platforms.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create Tournament"
        tabIndex={-1}
        className="w-full max-w-lg p-6"
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
            New Tournament
          </h2>
          <button onClick={onClose} aria-label="Close">
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
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. FIFA World Cup 2026"
              className="w-full px-3 py-2 text-sm"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
              autoFocus
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManual(true);
              }}
              placeholder="world-cup-2026"
              className="w-full px-3 py-2 text-sm mono"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
            />
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--c-ink-3)' }}
            >
              URL-friendly identifier. Auto-generated from name.
            </p>
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
              className="w-full px-3 py-2 text-sm h-28 resize-none mono"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                color: 'var(--c-ink)',
              }}
              maxLength={500}
            />
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--c-ink-3)' }}
            >
              Placeholders: {'{team_a}'}, {'{team_b}'}, {'{date}'}, {'{time}'}, {'{group_round}'}, {'{house_rules}'}, {'{booking_url}'}
            </p>
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
            onClick={handleCreate}
            disabled={saving || !canCreate}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{
              backgroundColor: 'var(--c-orange)',
              borderRadius: 'var(--r-md)',
            }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Tournament
          </button>
        </div>
      </div>
    </div>
  );
}
