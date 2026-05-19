import { redirect } from 'next/navigation';

/**
 * Dashboard page redirects to Planner (the new landing page).
 * Tournament routes at /dashboard/tournaments continue to work
 * as they are handled by their own route segment.
 */
export default function DashboardPage() {
  redirect('/planner');
}
