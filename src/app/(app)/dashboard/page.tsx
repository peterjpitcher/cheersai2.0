import { getCurrentUser } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

/**
 * Dashboard -- post-login landing page (D-05).
 * Server component that displays a welcome message.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">
          Welcome to CheersAI
          {user.businessName ? `, ${user.businessName}` : ''}
        </h1>
        <p className="text-muted-foreground mt-1">
          {user.email}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <p className="text-muted-foreground">
          Your social media command centre is ready. Use the sidebar to navigate
          to the planner, create content, or manage your connections.
        </p>
      </div>
    </div>
  );
}
