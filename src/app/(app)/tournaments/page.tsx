import { requireAuthContext } from '@/lib/auth/server';
import { getTournamentsByAccount } from '@/lib/tournament/queries';
import { TournamentList } from '@/features/tournament/components/TournamentList';
import { CreateTournamentButton } from '@/features/tournament/components/CreateTournamentButton';

export default async function TournamentsPage() {
  const { supabase, accountId } = await requireAuthContext();
  const tournaments = await getTournamentsByAccount(supabase, accountId);

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: 'var(--c-ink)' }}
          >
            Tournaments
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: 'var(--c-ink-3)' }}
          >
            Manage tournament fixtures and automated social content
          </p>
        </div>
        <CreateTournamentButton />
      </div>
      <TournamentList tournaments={tournaments} />
    </div>
  );
}
