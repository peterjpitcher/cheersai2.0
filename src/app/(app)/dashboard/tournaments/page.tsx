import { requireAuthContext } from '@/lib/auth/server';
import { getTournamentsByAccount } from '@/lib/tournament/queries';
import { TournamentList } from '@/features/tournament/components/TournamentList';

export default async function TournamentsPage() {
  const { supabase, accountId } = await requireAuthContext();
  const tournaments = await getTournamentsByAccount(supabase, accountId);

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Tournaments</h1>
          <p className="text-muted-foreground mt-1">
            Manage tournament fixtures and automated social content
          </p>
        </div>
      </div>
      <TournamentList tournaments={tournaments} />
    </div>
  );
}
