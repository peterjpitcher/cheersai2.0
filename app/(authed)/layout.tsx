import { redirect } from 'next/navigation';
import { getAuthWithCache } from '@/lib/supabase/auth-cache';
import { AuthProvider } from '@/components/auth/auth-provider';
import HeroNav from '@/components/navigation/hero-nav';
import MobileNav from '@/components/navigation/mobile-nav';
import Footer from '@/components/layout/footer';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use cached auth to avoid duplicate calls
  const { user, tenantId, tenantData } = await getAuthWithCache();
  
  if (!user) {
    redirect('/auth/login');
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
        <HeroNav 
          user={{
            firstName: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
            fullName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
            email: user.email!,
            avatarUrl: user.user_metadata?.avatar_url,
            timezone: user.user_metadata?.timezone || 'Europe/London',
          }}
          notificationCount={notificationCount}
        />
        <div className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
        <Footer />
        <MobileNav />
      </div>
    </AuthProvider>
  );
}