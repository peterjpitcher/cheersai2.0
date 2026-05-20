'use client';

import Link from 'next/link';
import { Trophy, Calendar, FileText } from 'lucide-react';
import type { TournamentWithStats } from '@/types/tournament';

interface TournamentListProps {
  tournaments: TournamentWithStats[];
}

export function TournamentList({ tournaments }: TournamentListProps) {
  if (tournaments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Trophy
          className="h-12 w-12 mb-4"
          style={{ color: 'var(--c-ink-4)' }}
        />
        <h2
          className="text-lg font-semibold mb-2"
          style={{ color: 'var(--c-ink)' }}
        >
          No tournaments yet
        </h2>
        <p
          className="mb-4 text-sm"
          style={{ color: 'var(--c-ink-3)' }}
        >
          Create your first tournament to start scheduling social content for upcoming games.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tournaments.map((tournament) => (
        <Link
          key={tournament.id}
          href={`/tournaments/${tournament.id}`}
          className="block p-5 transition-shadow hover:shadow-md"
          style={{
            backgroundColor: 'var(--c-card)',
            border: '1px solid var(--c-line)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--sh-sm)',
          }}
        >
          {/* Season eyebrow */}
          <span className="eyebrow">{tournament.status}</span>

          {/* Tournament name */}
          <h3
            className="mt-1 text-base font-semibold"
            style={{ color: 'var(--c-ink)' }}
          >
            {tournament.name}
          </h3>

          {/* Auto-posting chip if active */}
          {tournament.status === 'active' && (
            <span
              className="mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'var(--c-status-posted-bg)',
                color: 'var(--c-status-posted-fg)',
              }}
            >
              Auto-posting
            </span>
          )}

          {/* Big-number row */}
          <div className="mt-4 flex items-baseline gap-6">
            <div>
              <span
                className="mono text-2xl font-semibold"
                style={{ color: 'var(--c-ink)' }}
              >
                {tournament.showingCount}
              </span>
              <span
                className="ml-1 text-xs"
                style={{ color: 'var(--c-ink-3)' }}
              >
                / {tournament.totalFixtures} showing
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileText
                className="h-3.5 w-3.5"
                style={{ color: 'var(--c-ink-4)' }}
              />
              <span
                className="mono text-sm font-medium"
                style={{ color: 'var(--c-ink-2)' }}
              >
                {tournament.scheduledCount}
              </span>
              <span
                className="text-xs"
                style={{ color: 'var(--c-ink-3)' }}
              >
                posts
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div
            className="mt-3 flex gap-4 text-xs"
            style={{ color: 'var(--c-ink-3)' }}
          >
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {tournament.confirmedCount} confirmed
            </span>
            <span>{tournament.scheduledCount} scheduled</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
