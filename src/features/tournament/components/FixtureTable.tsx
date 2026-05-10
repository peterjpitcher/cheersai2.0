'use client';

import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type {
  Tournament,
  TournamentFixture,
  FixtureContentStatus,
} from '@/types/tournament';
import { FixtureRow } from './FixtureRow';
import { FixtureModal } from './FixtureModal';
import type { FixtureFormData } from './FixtureModal';
import { createFixture } from '@/app/actions/tournament';

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
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
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
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Fixture
        </button>

        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort:</span>
          <button
            onClick={() => setSortBy('date')}
            className={sortBy === 'date' ? 'font-medium' : 'text-muted-foreground'}
          >
            Date
          </button>
          <span className="text-muted-foreground">/</span>
          <button
            onClick={() => setSortBy('match')}
            className={sortBy === 'match' ? 'font-medium' : 'text-muted-foreground'}
          >
            Match #
          </button>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-16">#</th>
              <th className="px-3 py-2 text-left font-medium">Date/Time</th>
              <th className="px-3 py-2 text-left font-medium">Team A</th>
              <th className="px-3 py-2 text-center font-medium w-12">vs</th>
              <th className="px-3 py-2 text-left font-medium">Team B</th>
              <th className="px-3 py-2 text-left font-medium w-28">Round</th>
              <th className="px-3 py-2 text-center font-medium w-20">Showing</th>
              <th className="px-3 py-2 text-center font-medium w-24">Status</th>
              <th className="px-3 py-2 text-right font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((fixture) => (
              <FixtureRow
                key={fixture.id}
                fixture={fixture}
                tournament={tournament}
                contentStatus={deriveContentStatus(fixture, contentStatuses[fixture.id])}
                canGenerate={canGenerate}
              />
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
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
    </div>
  );
}
