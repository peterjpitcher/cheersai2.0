'use client';

import { useState, useRef } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import type { Tournament, TournamentFixture, FixtureContentStatus } from '@/types/tournament';
import {
  saveAndGenerateFixture,
  updateFixture,
  toggleFixtureShowing,
  publishNowFixture,
  deleteFixture,
} from '@/app/actions/tournament';
import { FixtureModal } from './FixtureModal';
import type { FixtureFormData } from './FixtureModal';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { StatusBadge } from './StatusBadge';

interface FixtureRowProps {
  fixture: TournamentFixture;
  tournament: Tournament;
  contentStatus: FixtureContentStatus;
  canGenerate: boolean;
}

export function FixtureRow({
  fixture,
  tournament,
  contentStatus,
  canGenerate,
}: FixtureRowProps) {
  const [editing, setEditing] = useState(false);
  const [teamA, setTeamA] = useState(fixture.teamA);
  const [teamB, setTeamB] = useState(fixture.teamB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const teamARef = useRef<HTMLInputElement>(null);

  const isModified = teamA !== fixture.teamA || teamB !== fixture.teamB;
  const autoConfirmed = areBothTeamsConfirmed(teamA, teamB);
  const canSaveAndGenerate =
    canGenerate && fixture.showing && autoConfirmed && isModified;

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
    try {
      await publishNowFixture(tournament.id, fixture.id);
    } finally {
      setLoading(false);
    }
  }

  async function handleEditSave(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
    return updateFixture(tournament.id, fixture.id, {
      teamA: data.teamA,
      teamB: data.teamB,
      teamsConfirmed: data.teamsConfirmed,
      showing: data.showing,
      showingNote: data.showingNote || null,
      bookingUrl: data.bookingUrl || null,
      kickOffAt: data.kickOffAt,
    });
  }

  async function handleEditSaveAndGenerate(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
    return saveAndGenerateFixture(tournament.id, fixture.id, {
      teamA: data.teamA,
      teamB: data.teamB,
      teamsConfirmed: data.teamsConfirmed,
      showing: data.showing,
      showingNote: data.showingNote || null,
      bookingUrl: data.bookingUrl || null,
      kickOffAt: data.kickOffAt,
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

  return (
    <tr className={`${isModified ? 'bg-amber-50/50' : ''} ${error ? 'bg-red-50/30' : ''}`}>
      <td className="px-3 py-2 text-muted-foreground">{fixture.matchNumber}</td>
      <td className="px-3 py-2">
        <div className="text-xs text-muted-foreground">{dateStr}</div>
        <div className="font-medium">{timeStr}</div>
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <input
            ref={teamARef}
            type="text"
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            maxLength={50}
          />
        ) : (
          <button
            onClick={() => {
              setEditing(true);
              setTimeout(() => teamARef.current?.focus(), 0);
            }}
            className="text-left hover:text-primary transition-colors w-full"
          >
            {fixture.teamA}
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-center text-muted-foreground text-xs">vs</td>
      <td className="px-3 py-2">
        {editing ? (
          <input
            type="text"
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            maxLength={50}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-left hover:text-primary transition-colors w-full"
          >
            {fixture.teamB}
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{roundLabel}</td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={fixture.showing}
          onChange={handleToggleShowing}
          disabled={loading}
          className="rounded border-gray-300"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <StatusBadge status={contentStatus} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}

          {confirmDelete ? (
            <>
              <span className="text-xs text-red-600 mr-1">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="rounded px-2 py-1 text-xs bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded px-2 py-1 text-xs text-muted-foreground"
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
                    className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80 disabled:opacity-50"
                  >
                    Save
                  </button>
                  {canSaveAndGenerate && (
                    <button
                      onClick={handleSaveAndGenerate}
                      disabled={loading}
                      className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Save & Generate
                    </button>
                  )}
                </>
              )}

              {editing && !isModified && (
                <button
                  onClick={() => setEditing(false)}
                  className="rounded px-2 py-1 text-xs text-muted-foreground"
                >
                  Cancel
                </button>
              )}

              {!editing && (
                <>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="rounded p-1 text-muted-foreground hover:text-primary"
                    title="Edit fixture"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={loading}
                    className="rounded p-1 text-muted-foreground hover:text-red-600"
                    title="Delete fixture"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {contentStatus === 'past_due' && (
                    <button
                      onClick={handlePublishNow}
                      disabled={loading}
                      className="rounded px-2 py-1 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Publish Now
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {error && <span className="text-xs text-red-600 ml-1">{error}</span>}
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
      </td>
    </tr>
  );
}
