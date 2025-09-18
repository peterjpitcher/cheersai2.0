"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Users,
  Building,
  CreditCard,
  TrendingUp,
  Settings,
  Search,
  Filter,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import Container from "@/components/layout/container";
import { Card } from "@/components/ui/card";
import { formatPlanLabel } from "@/lib/copy";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/datetime";
import { Badge } from "@/components/ui/badge";

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
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalTenants: 0,
    totalUsers: 0,
    activeSubscriptions: 0,
    totalRevenue: 0,
  });
  const [tenants, setTenants] = useState<TenantStats[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchDashboardData = useCallback(async () => {
    const supabase = createClient();

    try {
      setLoading(true);
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

            const postCount =
              posts?.reduce(
                (acc, campaign) => acc + (campaign.campaign_posts?.length || 0),
                0,
              ) || 0;

            return {
              ...tenant,
              user_count: userCount || 0,
              campaign_count: campaignCount || 0,
              post_count: postCount,
            };
          }),
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
  }, []);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  const filteredTenants = tenants.filter(tenant =>
    tenant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tenant.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-12 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="pb-page-pb pt-page-pt">
        {/* Stats Grid */}
        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <Building className="size-8 text-primary" />
              <span className="text-xs text-text-secondary">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalTenants}</p>
            <p className="text-sm text-text-secondary">Tenants</p>
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <Users className="size-8 text-success" />
              <span className="text-xs text-text-secondary">Total</span>
            </div>
            <p className="text-3xl font-bold">{stats.totalUsers}</p>
            <p className="text-sm text-text-secondary">Users</p>
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <CreditCard className="size-8 text-warning" />
              <span className="text-xs text-text-secondary">Active</span>
            </div>
            <p className="text-3xl font-bold">{stats.activeSubscriptions}</p>
            <p className="text-sm text-text-secondary">Subscriptions</p>
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <TrendingUp className="size-8 text-success" />
              <span className="text-xs text-text-secondary">Monthly</span>
            </div>
            <p className="text-3xl font-bold">£{stats.totalRevenue}</p>
            <p className="text-sm text-text-secondary">Revenue (est)</p>
          </Card>
        </div>

        {/* Tenants Table */}
        <Card className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-heading text-xl font-bold">All Tenants</h2>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
                <Input
                  placeholder="Search tenants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-64 pl-10"
                />
              </div>
              <Button variant="secondary">
                <Filter className="mr-2 size-4" />
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
                      <Badge
                        className={
                          tenant.subscription_tier === "pro"
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-secondary/30 bg-secondary/10 text-secondary-foreground"
                        }
                      >
                        {formatPlanLabel(tenant.subscription_tier)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          tenant.subscription_status === "active"
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-warning/30 bg-warning/10 text-warning"
                        }
                      >
                        {tenant.subscription_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{tenant.user_count}</TableCell>
                    <TableCell className="text-center">{tenant.campaign_count}</TableCell>
                    <TableCell className="text-center">{tenant.post_count}</TableCell>
                    <TableCell className="text-sm text-text-secondary">{formatDate(tenant.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Link 
                        href={`/admin/tenants/${tenant.id}`} 
                        className="inline-flex items-center text-primary hover:underline"
                        aria-label={`View details for ${tenant.name}`}
                      >
                        View
                        <ChevronRight className="ml-1 size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredTenants.length === 0 && (
            <div className="py-8 text-center text-text-secondary">
              <p>No tenants found</p>
            </div>
          )}
        </Card>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Link href="/admin/content-settings" className="block">
            <Card className="p-4 transition-colors hover:border-primary">
              <div className="flex items-center gap-4">
                <Settings className="size-8 text-primary" />
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
