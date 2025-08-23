"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Users, Building, CreditCard,
  TrendingUp, AlertCircle, Database, Settings,
  Search, Filter, ChevronRight, Shield
} from "lucide-react";
import Link from "next/link";
import Logo from "@/components/ui/logo";

interface TenantStats {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  subscription_status: string;
  user_count: number;
  campaign_count: number;
  post_count: number;
  created_at: string;
}

export default function SuperadminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [stats, setStats] = useState({
    totalTenants: 0,
    totalUsers: 0,
    activeSubscriptions: 0,
    totalRevenue: 0,
  });
  const [tenants, setTenants] = useState<TenantStats[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    checkAuthorization();
  }, []);

  const checkAuthorization = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Check if user is superadmin
    const { data: userData } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_superadmin) {
      router.push("/dashboard");
      return;
    }

    setIsAuthorized(true);
    await fetchDashboardData();
  };

  const fetchDashboardData = async () => {
    const supabase = createClient();
    
    try {
      // Get overall stats
      const { count: tenantCount } = await supabase
        .from("tenants")
        .select("*", { count: "exact", head: true });

      const { count: userCount } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true });

      const { count: activeSubCount } = await supabase
        .from("tenants")
        .select("*", { count: "exact", head: true })
        .eq("subscription_status", "active");

      // Get tenant details with user counts
      const { data: tenantsData } = await supabase
        .from("tenants")
        .select(`
          id,
          name,
          slug,
          subscription_tier,
          subscription_status,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (tenantsData) {
        // For each tenant, get counts
        const tenantsWithStats = await Promise.all(
          tenantsData.map(async (tenant) => {
            const { count: userCount } = await supabase
              .from("users")
              .select("*", { count: "exact", head: true })
              .eq("tenant_id", tenant.id);

            const { count: campaignCount } = await supabase
              .from("campaigns")
              .select("*", { count: "exact", head: true })
              .eq("tenant_id", tenant.id);

            const { data: posts } = await supabase
              .from("campaigns")
              .select("campaign_posts(id)")
              .eq("tenant_id", tenant.id);

            const postCount = posts?.reduce((acc, campaign) => 
              acc + (campaign.campaign_posts?.length || 0), 0) || 0;

            return {
              ...tenant,
              user_count: userCount || 0,
              campaign_count: campaignCount || 0,
              post_count: postCount,
            };
          })
        );

        setTenants(tenantsWithStats);
      }

      setStats({
        totalTenants: tenantCount || 0,
        totalUsers: userCount || 0,
        activeSubscriptions: activeSubCount || 0,
        totalRevenue: (activeSubCount || 0) * 29, // Rough estimate
      });

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTenants = tenants.filter(tenant =>
    tenant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tenant.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo variant="compact" className="h-11" />
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-warning" />
                <span className="text-sm font-medium text-warning">SUPERADMIN</span>
              </div>
            </div>
            <nav className="flex items-center gap-6">
              <Link href="/admin/dashboard" className="text-primary font-medium">
                Dashboard
              </Link>
              <Link href="/admin/tenants" className="text-text-secondary hover:text-primary">
                Tenants
              </Link>
              <Link href="/admin/content-settings" className="text-text-secondary hover:text-primary">
                Content Settings
              </Link>
              <Link href="/settings" className="text-text-secondary hover:text-primary">
                <Settings className="w-5 h-5" />
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <Building className="w-8 h-8 text-primary" />
              <span className="text-xs text-text-secondary">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalTenants}</p>
            <p className="text-sm text-text-secondary">Tenants</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-success" />
              <span className="text-xs text-text-secondary">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalUsers}</p>
            <p className="text-sm text-text-secondary">Users</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <CreditCard className="w-8 h-8 text-warning" />
              <span className="text-xs text-text-secondary">Active</span>
            </div>
            <p className="text-3xl font-bold">{stats.activeSubscriptions}</p>
            <p className="text-sm text-text-secondary">Subscriptions</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8 text-success" />
              <span className="text-xs text-text-secondary">Monthly</span>
            </div>
            <p className="text-3xl font-bold">£{stats.totalRevenue}</p>
            <p className="text-sm text-text-secondary">Revenue (est)</p>
          </div>
        </div>

        {/* Tenants Table */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-heading font-bold">All Tenants</h2>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input
                  type="text"
                  placeholder="Search tenants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field pl-10 w-64"
                />
              </div>
              <button className="btn-secondary">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Tenant</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Plan</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-text-secondary">Users</th>
                  <th className="text-center py-3 px-4 font-medium text-text-secondary">Campaigns</th>
                  <th className="text-center py-3 px-4 font-medium text-text-secondary">Posts</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Created</th>
                  <th className="text-right py-3 px-4 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b border-border hover:bg-surface">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-sm text-text-secondary">{tenant.slug}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge-${tenant.subscription_tier === 'pro' ? 'primary' : 'secondary'}`}>
                        {tenant.subscription_tier}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge-${tenant.subscription_status === 'active' ? 'success' : 'warning'}`}>
                        {tenant.subscription_status}
                      </span>
                    </td>
                    <td className="text-center py-3 px-4">{tenant.user_count}</td>
                    <td className="text-center py-3 px-4">{tenant.campaign_count}</td>
                    <td className="text-center py-3 px-4">{tenant.post_count}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary">
                      {new Date(tenant.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/admin/tenants/${tenant.id}`}
                        className="text-primary hover:underline inline-flex items-center"
                      >
                        View
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredTenants.length === 0 && (
            <div className="text-center py-8 text-text-secondary">
              <p>No tenants found</p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <Link href="/admin/content-settings" className="card hover:border-primary transition-colors">
            <div className="flex items-center gap-4">
              <Settings className="w-8 h-8 text-primary" />
              <div>
                <p className="font-medium">Global Settings</p>
                <p className="text-sm text-text-secondary">Manage content rules</p>
              </div>
            </div>
          </Link>

        </div>
      </main>
    </div>
  );
}