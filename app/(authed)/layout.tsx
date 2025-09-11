import { redirect } from 'next/navigation';
import { getAuthWithCache } from '@/lib/supabase/auth-cache';
import { createClient } from '@/lib/supabase/server';
import { unstable_noStore as noStore } from 'next/cache';
import { AuthProvider } from '@/components/auth/auth-provider';
import AppHeader from '@/components/layout/app-header';
import Footer from '@/components/layout/footer';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  noStore();
  // Use cached auth to avoid duplicate calls
  const { user, tenantId, tenantData } = await getAuthWithCache();
  
  if (!user) {
    redirect('/');
  }
  // Ensure a users row exists and adopt membership if needed
  try {
    const supabase = await createClient();
    const { data: userRow } = await supabase
      .from('users')
      .select('id, tenant_id, email, first_name, full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (!userRow) {
      await supabase.from('users').insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
        last_name: user.user_metadata?.last_name || '',
      });
    }
    // If tenantId missing, adopt from membership and persist best-effort
    if (!tenantId) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, created_at')
        .eq('user_id', user.id)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membership?.tenant_id) {
        await supabase
          .from('users')
          .update({ tenant_id: membership.tenant_id })
          .eq('id', user.id);
      }
    }
  } catch (e) {
    // Non-fatal; downstream pages fail-open and avoid redirect loops
    console.warn('ensure users row failed (layout):', e);
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
