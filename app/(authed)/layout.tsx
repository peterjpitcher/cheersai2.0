import { redirect } from 'next/navigation';
import { getAuthWithCache } from '@/lib/supabase/auth-cache';
import { AuthProvider } from '@/components/auth/auth-provider';
import AppHeader from '@/components/layout/app-header';
import Footer from '@/components/layout/footer';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use cached auth to avoid duplicate calls
  const { user, tenantId, tenantData } = await getAuthWithCache();
  
  if (!user) {
    redirect('/');
  }
  
  // Get notification count (for future use)
  const notificationCount = 0; // Placeholder for now
  
  return (
    <AuthProvider 
      initialUser={user} 
      initialTenantId={tenantId}
      initialTenantData={tenantData}
    >
      <div className="min-h-screen flex flex-col">
        <AppHeader 
          user={{
            email: user.email!,
            avatarUrl: user.user_metadata?.avatar_url,
            firstName: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
          }}
          notificationCount={notificationCount}
        />
        <div className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
        <Footer />
      </div>
    </AuthProvider>
  );
}
