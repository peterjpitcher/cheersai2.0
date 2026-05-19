'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { TournamentRound } from '@/types/tournament';

const ROUNDS: { value: TournamentRound; label: string }[] = [
  { value: 'group_stage', label: 'Group Stage' },
  { value: 'round_of_32', label: 'Round of 32' },
  { value: 'round_of_16', label: 'Round of 16' },
  { value: 'quarter_final', label: 'Quarter Final' },
  { value: 'semi_final', label: 'Semi Final' },
  { value: 'third_place', label: 'Third Place' },
  { value: 'final', label: 'Final' },
];

export interface FixtureFormData {
  matchNumber: number;
  round: TournamentRound;
  groupName: string;
  teamA: string;
  teamB: string;
  kickOffAt: string;
  venueCity: string;
  showing: boolean;
  showingNote: string;
  bookingUrl: string;
  teamsConfirmed: boolean;
}

interface FixtureModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: FixtureFormData) => Promise<{ success: boolean; error?: string }>;
  onSaveAndGenerate?: (data: FixtureFormData) => Promise<{ success: boolean; error?: string }>;
  title: string;
  initial?: Partial<FixtureFormData>;
  nextMatchNumber?: number;
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(local: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--c-line)',
  color: 'var(--c-ink)',
};

export function FixtureModal({
  open,
  onClose,
  onSave,
  onSaveAndGenerate,
  title,
  initial,
  nextMatchNumber = 1,
}: FixtureModalProps) {
  const [matchNumber, setMatchNumber] = useState(initial?.matchNumber ?? nextMatchNumber);
  const [round, setRound] = useState<TournamentRound>(initial?.round ?? 'group_stage');
  const [groupName, setGroupName] = useState(initial?.groupName ?? '');
  const [teamA, setTeamA] = useState(initial?.teamA ?? '');
  const [teamB, setTeamB] = useState(initial?.teamB ?? '');
  const [kickOffAt, setKickOffAt] = useState(initial?.kickOffAt ? toDatetimeLocal(initial.kickOffAt) : '');
  const [venueCity, setVenueCity] = useState(initial?.venueCity ?? '');
  const [showing, setShowing] = useState(initial?.showing ?? false);
  const [showingNote, setShowingNote] = useState(initial?.showingNote ?? '');
  const [bookingUrl, setBookingUrl] = useState(initial?.bookingUrl ?? '');
  const [teamsConfirmed, setTeamsConfirmed] = useState(initial?.teamsConfirmed ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMatchNumber(initial?.matchNumber ?? nextMatchNumber);
    setRound(initial?.round ?? 'group_stage');
    setGroupName(initial?.groupName ?? '');
    setTeamA(initial?.teamA ?? '');
    setTeamB(initial?.teamB ?? '');
    setKickOffAt(initial?.kickOffAt ? toDatetimeLocal(initial.kickOffAt) : '');
    setVenueCity(initial?.venueCity ?? '');
    setShowing(initial?.showing ?? false);
    setShowingNote(initial?.showingNote ?? '');
    setBookingUrl(initial?.bookingUrl ?? '');
    setTeamsConfirmed(initial?.teamsConfirmed ?? false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  function buildFormData(): FixtureFormData {
    return {
      matchNumber,
      round,
      groupName,
      teamA,
      teamB,
      kickOffAt: kickOffAt ? fromDatetimeLocal(kickOffAt) : '',
      venueCity,
      showing,
      showingNote,
      bookingUrl,
      teamsConfirmed,
    };
  }

  const isValid = teamA.trim() && teamB.trim() && kickOffAt && matchNumber > 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(buildFormData());
      if (!result.success) {
        setError(result.error ?? 'Failed to save');
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndGenerate() {
    if (!onSaveAndGenerate) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSaveAndGenerate(buildFormData());
      if (!result.success) {
        setError(result.error ?? 'Failed to save and generate');
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
            {title}
          </h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: 'var(--c-ink-3)' }} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--c-ink)' }}
              >
                Match Number *
              </label>
              <input
                type="number"
                value={matchNumber}
                onChange={(e) => setMatchNumber(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                min={1}
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--c-ink)' }}
              >
                Round *
              </label>
              <select
                value={round}
                onChange={(e) => setRound(e.target.value as TournamentRound)}
                className="w-full px-3 py-2 text-sm"
                style={{
                  ...inputStyle,
                  backgroundColor: 'var(--c-card)',
                }}
              >
                {ROUNDS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Group Name
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value.slice(0, 20))}
              className="w-full px-3 py-2 text-sm"
              style={inputStyle}
              placeholder="e.g. Group A"
              maxLength={20}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--c-ink)' }}
              >
                Team A *
              </label>
              <input
                type="text"
                value={teamA}
                onChange={(e) => setTeamA(e.target.value.slice(0, 50))}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                maxLength={50}
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--c-ink)' }}
              >
                Team B *
              </label>
              <input
                type="text"
                value={teamB}
                onChange={(e) => setTeamB(e.target.value.slice(0, 50))}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                maxLength={50}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--c-ink)' }}
              >
                Kick-off Date &amp; Time *
              </label>
              <input
                type="datetime-local"
                value={kickOffAt}
                onChange={(e) => setKickOffAt(e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--c-ink)' }}
              >
                Venue City
              </label>
              <input
                type="text"
                value={venueCity}
                onChange={(e) => setVenueCity(e.target.value.slice(0, 100))}
                className="w-full px-3 py-2 text-sm"
                style={inputStyle}
                maxLength={100}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--c-ink-2)' }}
            >
              <input
                type="checkbox"
                checked={showing}
                onChange={(e) => setShowing(e.target.checked)}
                className="rounded"
                style={{ borderColor: 'var(--c-line-2)' }}
              />
              Showing at venue
            </label>
            {initial && (
              <label
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--c-ink-2)' }}
              >
                <input
                  type="checkbox"
                  checked={teamsConfirmed}
                  onChange={(e) => setTeamsConfirmed(e.target.checked)}
                  className="rounded"
                  style={{ borderColor: 'var(--c-line-2)' }}
                />
                Teams confirmed (override)
              </label>
            )}
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Showing Note
            </label>
            <input
              type="text"
              value={showingNote}
              onChange={(e) => setShowingNote(e.target.value.slice(0, 200))}
              className="w-full px-3 py-2 text-sm"
              style={inputStyle}
              placeholder="e.g. Big screen in the garden"
              maxLength={200}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--c-ink)' }}
            >
              Booking URL
            </label>
            <input
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm"
              style={inputStyle}
              placeholder="https://..."
            />
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
          {onSaveAndGenerate && (
            <button
              onClick={handleSaveAndGenerate}
              disabled={saving || !isValid}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
              style={{
                backgroundColor: 'var(--c-paper-2)',
                color: 'var(--c-ink-2)',
                borderRadius: 'var(--r-md)',
              }}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save &amp; Generate
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isValid}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{
              backgroundColor: 'var(--c-orange)',
              borderRadius: 'var(--r-md)',
            }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
