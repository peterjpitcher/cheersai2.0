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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col gap-6">
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
            Your social media command centre is ready. Use the navigation to
            access the planner, create content, or manage your connections.
          </p>
        </div>
      </div>
    </div>
  );
}
