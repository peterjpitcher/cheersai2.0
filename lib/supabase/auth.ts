import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';

export async function getUser() {
  // Use the secure getAuthenticatedUser helper that properly validates sessions
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return { user: null, tenantId: null };
  }
  
  const supabase = await createClient();

  // Get tenant ID from user metadata or user_tenants table
  let tenantId = user.user_metadata?.tenant_id;
  
  if (!tenantId) {
    // Try to get from user_tenants table
    const { data: userTenant } = await supabase
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();
    
    tenantId = userTenant?.tenant_id;
  }

  return { user, tenantId };
}

export async function requireAuth() {
  const { user, tenantId } = await getUser();
  
  if (!user) {
    throw new Error('Unauthorized');
  }
  
  return { user, tenantId };
}