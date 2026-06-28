'use client';

import { useState, useRef } from 'react';
import { Loader2, Pencil, Trash2, Eye, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Tournament, TournamentFixture, FixtureContentStatus } from '@/types/tournament';
import {
  saveAndGenerateFixture,
  updateFixture,
  toggleFixtureShowing,
  publishNowFixture,
  deleteFixture,
} from '@/app/actions/tournament';
import { FixtureModal } from './FixtureModal';
import { FixturePreviewModal } from './FixturePreviewModal';
import type { FixtureFormData } from './FixtureModal';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { StatusBadge } from './StatusBadge';

interface FixtureRowProps {
  fixture: TournamentFixture;
  tournament: Tournament;
  contentStatus: FixtureContentStatus;
  canGenerate: boolean;
  even?: boolean;
}

export function FixtureRow({
  fixture,
  tournament,
  contentStatus,
  canGenerate,
  even = false,
}: FixtureRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [teamA, setTeamA] = useState(fixture.teamA);
  const [teamB, setTeamB] = useState(fixture.teamB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const teamARef = useRef<HTMLInputElement>(null);

  const isModified = teamA !== fixture.teamA || teamB !== fixture.teamB;
  const autoConfirmed = areBothTeamsConfirmed(teamA, teamB);
  const canSaveAndGenerate =
    canGenerate && fixture.showing && autoConfirmed && isModified;
  const canGenerateFixture =
    canGenerate
    && fixture.showing
    && fixture.teamsConfirmed
    && !editing
    && (contentStatus === 'ready' || contentStatus === 'blocked');

  const kickOff = new Date(fixture.kickOffAt);
  const dateStr = kickOff.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/London',
  });
  const timeStr = kickOff.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });

  const roundLabel =
    fixture.groupName ??
    fixture.round
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Determine if this is the next upcoming fixture
  const isNext = contentStatus === 'ready' && fixture.showing && fixture.teamsConfirmed;

  async function handleSaveAndGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await saveAndGenerateFixture(tournament.id, fixture.id, {
        teamA,
        teamB,
        teamsConfirmed: autoConfirmed,
        showing: fixture.showing,
        showingNote: fixture.showingNote,
        bookingUrl: fixture.bookingUrl,
        kickOffAt: fixture.kickOffAt,
      });
      if (!result.success) {
        setError(result.error ?? 'Generation failed');
      }
      setEditing(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateFixture() {
    if (!canGenerateFixture) return;

    setLoading(true);
    setError(null);
    try {
      const result = await saveAndGenerateFixture(tournament.id, fixture.id, {
        matchNumber: fixture.matchNumber,
        round: fixture.round,
        groupName: fixture.groupName,
        teamA: fixture.teamA,
        teamB: fixture.teamB,
        teamsConfirmed: fixture.teamsConfirmed,
        showing: fixture.showing,
        showingNote: fixture.showingNote,
        bookingUrl: fixture.bookingUrl,
        kickOffAt: fixture.kickOffAt,
        venueCity: fixture.venueCity,
      });

      if (!result.success) {
        setError(result.error ?? 'Generation failed');
        return;
      }

      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveOnly() {
    setLoading(true);
    setError(null);
    try {
      const result = await updateFixture(tournament.id, fixture.id, {
        teamA,
        teamB,
        teamsConfirmed: autoConfirmed,
        showing: fixture.showing,
        showingNote: fixture.showingNote,
        bookingUrl: fixture.bookingUrl,
        kickOffAt: fixture.kickOffAt,
      });
      if (!result.success) {
        setError(result.error ?? 'Save failed');
      }
      setEditing(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleShowing() {
    setLoading(true);
    try {
      await toggleFixtureShowing(tournament.id, fixture.id, !fixture.showing);
    } finally {
      setLoading(false);
    }
  }

  async function handlePublishNow() {
    setLoading(true);
    setError(null);
    try {
      const result = await publishNowFixture(tournament.id, fixture.id);
      if (!result.success) {
        setError(result.error ?? 'Publish failed');
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSave(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
    return updateFixture(tournament.id, fixture.id, {
      matchNumber: data.matchNumber,
      round: data.round,
      groupName: data.groupName || null,
      teamA: data.teamA,
      teamB: data.teamB,
      teamsConfirmed: data.teamsConfirmed,
      showing: data.showing,
      showingNote: data.showingNote || null,
      bookingUrl: data.bookingUrl || null,
      kickOffAt: data.kickOffAt,
      venueCity: data.venueCity || null,
    });
  }

  async function handleEditSaveAndGenerate(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
    return saveAndGenerateFixture(tournament.id, fixture.id, {
      matchNumber: data.matchNumber,
      round: data.round,
      groupName: data.groupName || null,
      teamA: data.teamA,
      teamB: data.teamB,
      teamsConfirmed: data.teamsConfirmed,
      showing: data.showing,
      showingNote: data.showingNote || null,
      bookingUrl: data.bookingUrl || null,
      kickOffAt: data.kickOffAt,
      venueCity: data.venueCity || null,
    });
  }

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const result = await deleteFixture(tournament.id, fixture.id);
      if (!result.success) {
        setError(result.error ?? 'Delete failed');
      }
      setConfirmDelete(false);
    } finally {
      setLoading(false);
    }
  }

  // Row background: modified > error > "next" highlight > alternating tint
  let rowBg = even ? 'var(--c-card)' : 'var(--c-paper)';
  if (isNext) rowBg = 'var(--c-orange-soft)';
  if (error) rowBg = 'var(--c-claret-soft)';
  if (isModified) rowBg = 'var(--c-orange-tint)';

  return (
    <tr
      style={{
        backgroundColor: rowBg,
        borderBottom: '1px solid var(--c-line)',
      }}
    >
      <td
        className="px-3 py-2 mono text-xs"
        style={{ color: 'var(--c-ink-3)' }}
      >
        {fixture.matchNumber}
      </td>
      <td className="px-3 py-2">
        <div className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          {dateStr}
        </div>
        <div
          className="mono font-medium"
          style={{ color: 'var(--c-ink)' }}
        >
          {timeStr}
        </div>
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <input
            ref={teamARef}
            type="text"
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            className="w-full px-2 py-1 text-sm"
            style={{
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--c-line-2)',
            }}
            maxLength={50}
          />
        ) : (
          <button
            onClick={() => {
              setEditing(true);
              setTimeout(() => teamARef.current?.focus(), 0);
            }}
            className="text-left transition-colors w-full"
            style={{ color: 'var(--c-ink)' }}
          >
            {fixture.teamA}
          </button>
        )}
      </td>
      <td
        className="px-3 py-2 text-center text-xs"
        style={{ color: 'var(--c-ink-4)' }}
      >
        vs
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <input
            type="text"
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            className="w-full px-2 py-1 text-sm"
            style={{
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--c-line-2)',
            }}
            maxLength={50}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-left transition-colors w-full"
            style={{ color: 'var(--c-ink)' }}
          >
            {fixture.teamB}
          </button>
        )}
      </td>
      <td
        className="px-3 py-2 text-xs"
        style={{ color: 'var(--c-ink-3)' }}
      >
        {roundLabel}
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={fixture.showing}
          onChange={handleToggleShowing}
          disabled={loading}
          className="rounded"
          style={{ borderColor: 'var(--c-line-2)' }}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <StatusBadge status={contentStatus} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {loading && (
            <Loader2
              className="h-4 w-4 animate-spin"
              style={{ color: 'var(--c-ink-4)' }}
            />
          )}

          {confirmDelete ? (
            <>
              <span
                className="text-xs mr-1"
                style={{ color: 'var(--c-claret)' }}
              >
                Delete?
              </span>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="px-2 py-1 text-xs text-white disabled:opacity-50 transition-colors"
                style={{
                  backgroundColor: 'var(--c-claret)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs"
                style={{
                  color: 'var(--c-ink-3)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                No
              </button>
            </>
          ) : (
            <>
              {editing && isModified && (
                <>
                  <button
                    onClick={handleSaveOnly}
                    disabled={loading}
                    className="px-2 py-1 text-xs disabled:opacity-50 transition-colors"
                    style={{
                      backgroundColor: 'var(--c-paper-2)',
                      color: 'var(--c-ink-2)',
                      borderRadius: 'var(--r-sm)',
                    }}
                  >
                    Save
                  </button>
                  {canSaveAndGenerate && (
                    <button
                      onClick={handleSaveAndGenerate}
                      disabled={loading}
                      className="px-2 py-1 text-xs text-white disabled:opacity-50 transition-colors"
                      style={{
                        backgroundColor: 'var(--c-orange)',
                        borderRadius: 'var(--r-sm)',
                      }}
                    >
                      Save & Generate
                    </button>
                  )}
                </>
              )}

              {editing && !isModified && (
                <button
                  onClick={() => setEditing(false)}
                  className="px-2 py-1 text-xs"
                  style={{
                    color: 'var(--c-ink-3)',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  Cancel
                </button>
              )}

              {!editing && (
                <>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="p-1 transition-colors"
                    style={{
                      color: 'var(--c-ink-3)',
                      borderRadius: 'var(--r-sm)',
                    }}
                    title="Edit fixture"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={loading}
                    className="p-1 transition-colors"
                    style={{
                      color: 'var(--c-ink-3)',
                      borderRadius: 'var(--r-sm)',
                    }}
                    title="Delete fixture"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {fixture.contentGenerated && (
                    <button
                      onClick={() => setPreviewOpen(true)}
                      className="p-1 transition-colors"
                      style={{
                        color: 'var(--c-ink-3)',
                        borderRadius: 'var(--r-sm)',
                      }}
                      title="Preview content"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canGenerateFixture && (
                    <button
                      onClick={handleGenerateFixture}
                      disabled={loading}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white disabled:opacity-50 transition-colors"
                      style={{
                        backgroundColor: 'var(--c-orange)',
                        borderRadius: 'var(--r-sm)',
                      }}
                      title="Generate content for this fixture"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {fixture.contentGenerated ? 'Regenerate' : 'Generate'}
                    </button>
                  )}
                  {contentStatus === 'past_due' && (
                    <button
                      onClick={handlePublishNow}
                      disabled={loading}
                      className="px-2 py-1 text-xs text-white disabled:opacity-50 transition-colors"
                      style={{
                        backgroundColor: 'var(--c-orange)',
                        borderRadius: 'var(--r-sm)',
                      }}
                    >
                      Publish Now
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {error && (
            <span
              className="text-xs ml-1"
              style={{ color: 'var(--c-claret)' }}
            >
              {error}
            </span>
          )}
        </div>

        <FixtureModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSave={handleEditSave}
          onSaveAndGenerate={canGenerate ? handleEditSaveAndGenerate : undefined}
          title={`Edit Fixture #${fixture.matchNumber}`}
          initial={{
            matchNumber: fixture.matchNumber,
            round: fixture.round,
            groupName: fixture.groupName ?? '',
            teamA: fixture.teamA,
            teamB: fixture.teamB,
            kickOffAt: fixture.kickOffAt,
            venueCity: fixture.venueCity ?? '',
            showing: fixture.showing,
            showingNote: fixture.showingNote ?? '',
            bookingUrl: fixture.bookingUrl ?? '',
            teamsConfirmed: fixture.teamsConfirmed,
          }}
        />
        <FixturePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          tournamentId={tournament.id}
          fixtureId={fixture.id}
          fixtureLabel={`#${fixture.matchNumber} ${fixture.teamA} vs ${fixture.teamB}`}
        />
      </td>
    </tr>
  );
}
