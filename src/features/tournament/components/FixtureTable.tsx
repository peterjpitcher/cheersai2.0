'use client';

import { useState, useMemo } from 'react';
import { Plus, Upload } from 'lucide-react';
import type {
  Tournament,
  TournamentFixture,
  FixtureContentStatus,
} from '@/types/tournament';
import { FixtureRow } from './FixtureRow';
import { FixtureModal } from './FixtureModal';
import type { FixtureFormData } from './FixtureModal';
import { createFixture } from '@/app/actions/tournament';
import { ImportFixturesModal } from './ImportFixturesModal';

interface FixtureTableProps {
  tournament: Tournament;
  fixtures: TournamentFixture[];
  canGenerate: boolean;
  contentStatuses?: Record<string, string>;
}

type FilterKey = 'all' | 'showing' | 'needs_teams' | 'ready' | 'generated';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'showing', label: 'Showing' },
  { key: 'needs_teams', label: 'Needs Teams' },
  { key: 'ready', label: 'Ready to Generate' },
  { key: 'generated', label: 'Generated' },
];

function deriveContentStatus(
  fixture: TournamentFixture,
  serverStatus?: string,
): FixtureContentStatus {
  if (!fixture.showing) return 'not_showing';
  if (!fixture.teamsConfirmed) return 'no_teams';
  if (fixture.contentGenerated && serverStatus) return serverStatus as FixtureContentStatus;
  if (fixture.contentGenerated) return 'scheduled';
  return 'ready';
}

function matchesFilter(fixture: TournamentFixture, key: FilterKey): boolean {
  switch (key) {
    case 'showing':
      return fixture.showing;
    case 'needs_teams':
      return fixture.showing && !fixture.teamsConfirmed;
    case 'ready':
      return fixture.showing && fixture.teamsConfirmed && !fixture.contentGenerated;
    case 'generated':
      return fixture.contentGenerated;
    default:
      return true;
  }
}

export function FixtureTable({ tournament, fixtures, canGenerate, contentStatuses = {} }: FixtureTableProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<'date' | 'match'>('date');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const nextMatchNumber = useMemo(() => {
    if (!fixtures.length) return 1;
    return Math.max(...fixtures.map((f) => f.matchNumber)) + 1;
  }, [fixtures]);

  async function handleAddFixture(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
    return createFixture(tournament.id, {
      matchNumber: data.matchNumber,
      round: data.round,
      groupName: data.groupName || null,
      teamA: data.teamA,
      teamB: data.teamB,
      kickOffAt: data.kickOffAt,
      venueCity: data.venueCity || null,
      showing: data.showing,
      showingNote: data.showingNote || null,
      bookingUrl: data.bookingUrl || null,
    });
  }

  const filtered = useMemo(() => {
    const result = fixtures.filter((f) => matchesFilter(f, filter));

    if (sortBy === 'match') {
      return result.sort((a, b) => a.matchNumber - b.matchNumber);
    }
    return result.sort(
      (a, b) => new Date(a.kickOffAt).getTime() - new Date(b.kickOffAt).getTime(),
    );
  }, [fixtures, filter, sortBy]);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="rounded-full px-3 py-1 text-sm transition-colors"
            style={{
              backgroundColor: filter === f.key ? 'var(--c-orange)' : 'var(--c-paper-2)',
              color: filter === f.key ? 'var(--c-card)' : 'var(--c-ink-3)',
            }}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="ml-1">
                ({fixtures.filter((fx) => matchesFilter(fx, f.key)).length})
              </span>
            )}
          </button>
        ))}

        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm text-white transition-colors"
          style={{ backgroundColor: 'var(--c-orange)' }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Fixture
        </button>

        <button
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm transition-colors"
          style={{
            backgroundColor: 'var(--c-paper-2)',
            color: 'var(--c-ink-3)',
          }}
        >
          <Upload className="h-3.5 w-3.5" />
          Import CSV
        </button>

        <div className="ml-auto flex items-center gap-2 text-sm">
          <span style={{ color: 'var(--c-ink-3)' }}>Sort:</span>
          <button
            onClick={() => setSortBy('date')}
            className="transition-colors"
            style={{
              fontWeight: sortBy === 'date' ? 500 : 400,
              color: sortBy === 'date' ? 'var(--c-ink)' : 'var(--c-ink-3)',
            }}
          >
            Date
          </button>
          <span style={{ color: 'var(--c-ink-4)' }}>/</span>
          <button
            onClick={() => setSortBy('match')}
            className="transition-colors"
            style={{
              fontWeight: sortBy === 'match' ? 500 : 400,
              color: sortBy === 'match' ? 'var(--c-ink)' : 'var(--c-ink-3)',
            }}
          >
            Match #
          </button>
        </div>
      </div>

      {/* Fixture table */}
      <div
        className="overflow-x-auto"
        style={{
          borderRadius: 'var(--r-xl)',
          border: '1px solid var(--c-line)',
        }}
      >
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--c-paper-2)' }}>
              <th className="eyebrow px-3 py-2 text-left w-16">#</th>
              <th className="eyebrow px-3 py-2 text-left">Date/Time</th>
              <th className="eyebrow px-3 py-2 text-left">Team A</th>
              <th className="eyebrow px-3 py-2 text-center w-12">vs</th>
              <th className="eyebrow px-3 py-2 text-left">Team B</th>
              <th className="eyebrow px-3 py-2 text-left w-28">Round</th>
              <th className="eyebrow px-3 py-2 text-center w-20">Showing</th>
              <th className="eyebrow px-3 py-2 text-center w-24">Status</th>
              <th className="eyebrow px-3 py-2 text-right w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((fixture, index) => (
              <FixtureRow
                key={fixture.id}
                fixture={fixture}
                tournament={tournament}
                contentStatus={deriveContentStatus(fixture, contentStatuses[fixture.id])}
                canGenerate={canGenerate}
                even={index % 2 === 0}
              />
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div
            className="py-12 text-center text-sm"
            style={{ color: 'var(--c-ink-3)' }}
          >
            No fixtures match the current filter.
          </div>
        )}
      </div>

      <FixtureModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={handleAddFixture}
        title="Add Fixture"
        nextMatchNumber={nextMatchNumber}
      />

      <ImportFixturesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tournamentId={tournament.id}
      />
    </div>
  );
}
