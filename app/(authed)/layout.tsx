import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import HeroNav from '@/components/navigation/hero-nav';
import MobileNav from '@/components/navigation/mobile-nav';
import Footer from '@/components/layout/footer';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/auth/login');
  }
  
  // Fetch minimal user data for navigation
  const { data: userData } = await supabase
    .from('users')
    .select('first_name, last_name, full_name, email, avatar_url, timezone')
    .eq('id', user.id)
    .single();
  
  // Get notification count (for future use)
  const notificationCount = 0; // Placeholder for now since we don't have notifications table yet
  
  return (
    <div className="min-h-screen flex flex-col">
      <HeroNav 
        user={{
          firstName: userData?.first_name || userData?.full_name?.split(' ')[0] || 'User',
          fullName: userData?.full_name || 'User',
          email: userData?.email || user.email!,
          avatarUrl: userData?.avatar_url,
          timezone: userData?.timezone,
        }}
        notificationCount={notificationCount}
      />
      <div className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>
      <Footer />
      <MobileNav />
    </div>
  );
}