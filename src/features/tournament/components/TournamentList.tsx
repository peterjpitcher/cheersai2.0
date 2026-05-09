'use client';

import Link from 'next/link';
import { Trophy } from 'lucide-react';
import type { TournamentWithStats } from '@/types/tournament';

interface TournamentListProps {
  tournaments: TournamentWithStats[];
}

const STATUS_COLOURS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
};

export function TournamentList({ tournaments }: TournamentListProps) {
  if (tournaments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">No tournaments yet</h2>
        <p className="text-muted-foreground mb-4">
          Create your first tournament to start scheduling social content for upcoming games.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {tournaments.map((tournament) => (
        <Link
          key={tournament.id}
          href={`/dashboard/tournaments/${tournament.id}`}
          className="block rounded-lg border bg-card p-6 hover:border-primary transition-colors"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-lg font-semibold">{tournament.name}</h2>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOURS[tournament.status] ?? ''}`}
                >
                  {tournament.status}
                </span>
              </div>
              <div className="flex gap-6 text-sm text-muted-foreground">
                <span>{tournament.showingCount}/{tournament.totalFixtures} showing</span>
                <span>{tournament.confirmedCount} confirmed</span>
                <span>{tournament.scheduledCount} scheduled</span>
              </div>
            </div>
            <Trophy className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>
      ))}
    </div>
  );
}
