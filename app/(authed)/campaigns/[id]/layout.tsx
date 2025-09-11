import { createClient } from '@/lib/supabase/server';
import SubNav from '@/components/navigation/sub-nav';
import { filterNavItems, subNavPresets } from '@/components/navigation/navigation.config';
import Container from '@/components/layout/container';

export default async function CampaignDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const supabase = await createClient();
  
  // Get user permissions
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return null; // Parent layout will redirect
  }
  
  const { data: userData } = await supabase
    .from('users')
    .select(`
      role,
      tenant:tenants!users_tenant_id_fkey (
        id,
        subscription_tier
      )
    `)
    .eq('id', user.id)
    .single();
  
  const tenant = Array.isArray(userData?.tenant) ? userData.tenant[0] : userData?.tenant;
  
  // Check if has connections
  const { count: connectionCount } = await supabase
    .from('social_connections')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant?.id || '');
  
  // Filter items based on permissions
  const items = filterNavItems(subNavPresets.campaignDetail, {
    plan: tenant?.subscription_tier,
    role: userData?.role,
    hasConnections: (connectionCount || 0) > 0,
  });
  
  return (
    <>
      <SubNav 
        base={`/campaigns/${resolvedParams.id}`} 
        preset="campaignDetail"
        itemsOverride={items}
      />
      <main>
        <Container className="section-y">{children}</Container>
      </main>
    </>
  );
}
