'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

interface AuthContextType {
  user: User | null;
  tenantId: string | null;
  tenantData: any;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  tenantId: null,
  tenantData: null,
  isLoading: true,
  refresh: async () => {},
});

interface AuthProviderProps {
  children: React.ReactNode;
  initialUser?: User | null;
  initialTenantId?: string | null;
  initialTenantData?: any;
}

export function AuthProvider({ 
  children, 
  initialUser = null,
  initialTenantId = null,
  initialTenantData = null,
}: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [tenantId, setTenantId] = useState<string | null>(initialTenantId);
  const [tenantData, setTenantData] = useState<any>(initialTenantData);
  const [isLoading, setIsLoading] = useState(!initialUser);
  
  const supabase = createClient();

  const refresh = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        setUser(user);
        
        // Fetch tenant data
        const { data: userData } = await supabase
          .from('users')
          .select('tenant_id, tenants(*)')
          .eq('id', user.id)
          .maybeSingle();

        let tId: string | null = userData?.tenant_id ?? null;
        let tData: any = userData?.tenants ?? null;
        if (!tId) {
          const { data: membership } = await supabase
            .from('user_tenants')
            .select('tenant_id, role, created_at')
            .eq('user_id', user.id)
            .order('role', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (membership?.tenant_id) {
            tId = membership.tenant_id as string;
            // Persist for future reads (ignore errors silently)
            await supabase.from('users').update({ tenant_id: tId }).eq('id', user.id);
            // Try to fetch tenant info
            const { data: t } = await supabase
              .from('tenants')
              .select('*')
              .eq('id', tId)
              .maybeSingle();
            tData = t || null;
          }
        }
        setTenantId(tId);
        setTenantData(tData);
      } else {
        setUser(null);
        setTenantId(null);
        setTenantData(null);
      }
    } catch (error) {
      console.error('Error refreshing auth:', error);
      setUser(null);
      setTenantId(null);
      setTenantData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch if no initial data provided
    if (!initialUser) {
      refresh();
    }
    
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          await refresh();
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setTenantId(null);
          setTenantData(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, tenantId, tenantData, isLoading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Convenience hooks
export function useUser() {
  const { user } = useAuth();
  return user;
}

export function useTenantId() {
  const { tenantId } = useAuth();
  return tenantId;
}

export function useIsAuthenticated() {
  const { user } = useAuth();
  return !!user;
}
