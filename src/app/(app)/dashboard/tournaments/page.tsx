import { redirect } from 'next/navigation';

/**
 * Legacy route — redirects to /tournaments.
 * Tournaments moved to root-level route for consistency with other sections.
 */
export default function LegacyTournamentsPage() {
  redirect('/tournaments');
}
