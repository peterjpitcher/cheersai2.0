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
import Container from "@/components/layout/container";
import Logo from "@/components/ui/logo";
import { Card, CardContent } from "@/components/ui/card";
import { formatPlanLabel } from "@/lib/copy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/datetime";

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
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo variant="compact" className="h-11" />
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-warning" />
                <span className="text-sm font-medium text-warning">SUPERADMIN</span>
              </div>
            </div>
            {/* Navigation removed; SubNav in layout provides section navigation */}
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Building className="w-8 h-8 text-primary" />
              <span className="text-xs text-text-secondary">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalTenants}</p>
            <p className="text-sm text-text-secondary">Tenants</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-success" />
              <span className="text-xs text-text-secondary">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalUsers}</p>
            <p className="text-sm text-text-secondary">Users</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <CreditCard className="w-8 h-8 text-warning" />
              <span className="text-xs text-text-secondary">Active</span>
            </div>
            <p className="text-3xl font-bold">{stats.activeSubscriptions}</p>
            <p className="text-sm text-text-secondary">Subscriptions</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8 text-success" />
              <span className="text-xs text-text-secondary">Monthly</span>
            </div>
            <p className="text-3xl font-bold">£{stats.totalRevenue}</p>
            <p className="text-sm text-text-secondary">Revenue (est)</p>
          </Card>
        </div>

        {/* Tenants Table */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-heading font-bold">All Tenants</h2>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <Input
                  placeholder="Search tenants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Button variant="secondary">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <TableRow className="border-b border-border">
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-center">Campaigns</TableHead>
                  <TableHead className="text-center">Posts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-sm text-text-secondary">{tenant.slug}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`badge-${tenant.subscription_tier === 'pro' ? 'primary' : 'secondary'}`}>
                        {formatPlanLabel(tenant.subscription_tier)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`badge-${tenant.subscription_status === 'active' ? 'success' : 'warning'}`}>
                        {tenant.subscription_status}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">{tenant.user_count}</TableCell>
                    <TableCell className="text-center">{tenant.campaign_count}</TableCell>
                    <TableCell className="text-center">{tenant.post_count}</TableCell>
                    <TableCell className="text-sm text-text-secondary">{formatDate(tenant.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Link 
                        href={`/admin/tenants/${tenant.id}`} 
                        className="text-primary hover:underline inline-flex items-center"
                        aria-label={`View details for ${tenant.name}`}
                      >
                        View
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredTenants.length === 0 && (
            <div className="text-center py-8 text-text-secondary">
              <p>No tenants found</p>
            </div>
          )}
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <Link href="/admin/content-settings" className="block">
            <Card className="hover:border-primary transition-colors p-4">
              <div className="flex items-center gap-4">
                <Settings className="w-8 h-8 text-primary" />
                <div>
                  <p className="font-medium">Global Settings</p>
                  <p className="text-sm text-text-secondary">Manage content rules</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
        </Container>
      </main>
    </div>
  );
}
