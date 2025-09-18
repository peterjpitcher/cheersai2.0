"use client";

import { useState, useEffect, useCallback, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Building,
  CreditCard,
  Search,
  ChevronRight,
  Edit2,
  Trash2,
  CheckCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";
import Container from "@/components/layout/container";
import { formatDate } from "@/lib/datetime";
import { Card } from "@/components/ui/card";
import { formatPlanLabel } from "@/lib/copy";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  subscription_status: string;
  trial_ends_at: string;
  created_at: string;
  updated_at: string;
  users?: Array<{ count: number | null }>;
  campaigns?: Array<{ count: number | null }>;
}

export default function TenantsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  const fetchTenants = useCallback(async () => {
    const supabase = createClient();

    try {
      const { data, error } = await supabase
        .from("tenants")
        .select(`
          *,
          users:users(count),
          campaigns:campaigns(count)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error("Error fetching tenants:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkAuthorization = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push("/");
      return;
    }

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
    await fetchTenants();
  }, [fetchTenants, router]);

  useEffect(() => {
    void checkAuthorization();
  }, [checkAuthorization]);

  const handleSaveTenant = async (
    tenantId: string,
    updates: { subscription_status: Tenant["subscription_status"]; subscription_tier: Tenant["subscription_tier"]; },
  ) => {
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from("tenants")
        .update({
          subscription_status: updates.subscription_status,
          subscription_tier: updates.subscription_tier,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tenantId);

      if (error) throw error;
      await fetchTenants();
    } catch (error) {
      console.error("Error updating tenant:", error);
    }
  };

  const handleDeleteTenant = async (tenantId: string) => {
    if (!confirm("Are you sure you want to delete this tenant? This action cannot be undone.")) {
      return;
    }

    const supabase = createClient();
    
    try {
      const { error } = await supabase
        .from("tenants")
        .delete()
        .eq("id", tenantId);

      if (error) throw error;
      await fetchTenants();
    } catch (error) {
      console.error("Error deleting tenant:", error);
    }
  };

  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch = tenant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          tenant.slug.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || tenant.subscription_status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusBadgeClass = (status: Tenant["subscription_status"]) => {
    switch (status) {
      case 'active':
        return "border-success/30 bg-success/10 text-success";
      case 'trial':
        return "border-warning/30 bg-warning/10 text-warning";
      case 'cancelled':
        return "border-destructive/30 bg-destructive/10 text-destructive";
      default:
        return "border-secondary/30 bg-secondary/10 text-secondary-foreground";
    }
  };

  const getTierBadgeClass = (tier: Tenant["subscription_tier"]) => {
    switch (tier) {
      case 'pro':
        return "border-primary/30 bg-primary/10 text-primary";
      case 'business':
        return "border-success/30 bg-success/10 text-success";
      case 'starter':
        return "border-warning/30 bg-warning/10 text-warning";
      default:
        return "border-secondary/30 bg-secondary/10 text-secondary-foreground";
    }
  };

  const handleStatusFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFilterStatus(event.target.value);
  };

  const handleSelectedTenantStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedTenant((previous) =>
      previous
        ? {
            ...previous,
            subscription_status: event.target.value,
          }
        : previous,
    );
  };

  const handleSelectedTenantTierChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedTenant((previous) =>
      previous
        ? {
            ...previous,
            subscription_tier: event.target.value,
          }
        : previous,
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-12 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="pb-page-pb pt-page-pt">
        <div className="mb-8">
          <h1 className="mb-2 font-heading text-3xl font-bold">Tenant Management</h1>
          <p className="text-text-secondary">Manage all tenants in the system</p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{tenants.length}</p>
                <p className="text-sm text-text-secondary">Total Tenants</p>
              </div>
              <Building className="size-8 text-primary" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {tenants.filter(t => t.subscription_status === 'active').length}
                </p>
                <p className="text-sm text-text-secondary">Active</p>
              </div>
              <CheckCircle className="size-8 text-success" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {tenants.filter(t => t.subscription_status === 'trial').length}
                </p>
                <p className="text-sm text-text-secondary">Trial</p>
              </div>
              <Clock className="size-8 text-warning" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {tenants.filter(t => t.subscription_tier === 'pro').length}
                </p>
                <p className="text-sm text-text-secondary">Professional Tier</p>
              </div>
              <CreditCard className="size-8 text-primary" />
            </div>
          </Card>
        </div>

        {/* Controls */}
        <div className="mb-6 flex items-center justify-between">
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
            <Select
              aria-label="Filter by subscription status"
              value={filterStatus}
              onChange={handleStatusFilterChange}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
        </div>

        {/* Tenants Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader className="border-b border-border bg-surface">
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-center">Campaigns</TableHead>
                  <TableHead>Trial Ends</TableHead>
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
                      <Badge className={getTierBadgeClass(tenant.subscription_tier)}>
                        {formatPlanLabel(tenant.subscription_tier)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadgeClass(tenant.subscription_status)}>
                        {tenant.subscription_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {tenant.users?.[0]?.count || 0}
                    </TableCell>
                    <TableCell className="text-center">
                      {tenant.campaigns?.[0]?.count || 0}
                    </TableCell>
                    <TableCell className="text-sm">
                      {tenant.trial_ends_at ? formatDate(tenant.trial_ends_at) : '-'}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(tenant.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/tenants/${tenant.id}`}
                          className="rounded-chip p-2 hover:bg-background"
                          title="View Details"
                          aria-label={`View details for ${tenant.name}`}
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                        <button
                          onClick={() => setSelectedTenant(tenant)}
                          className="rounded-chip p-2 hover:bg-background"
                          title="Edit"
                          aria-label={`Edit ${tenant.name}`}
                        >
                          <Edit2 className="size-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(tenant.id)}
                          className="rounded-chip p-2 hover:bg-background"
                          title="Delete"
                          aria-label={`Delete ${tenant.name}`}
                        >
                          <Trash2 className="size-4 text-error" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredTenants.length === 0 && (
            <div className="py-12 text-center text-text-secondary">
              <Building className="mx-auto mb-4 size-12 opacity-50" />
              <p>No tenants found</p>
            </div>
          )}
        </Card>

        {/* Edit Modal */}
        {selectedTenant && (
          <Dialog
            open={!!selectedTenant}
            onOpenChange={(isOpen) => {
              if (!isOpen) setSelectedTenant(null);
            }}
          >
            <DialogContent className="flex max-w-md flex-col overflow-hidden p-0">
              <DialogHeader className="px-6 py-4">
                <DialogTitle className="font-heading text-xl">Edit Tenant</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 overflow-y-auto px-6 pb-6">
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="tenant-status">
                    Subscription Status
                  </label>
                  <Select
                    id="tenant-status"
                    value={selectedTenant.subscription_status}
                    onChange={handleSelectedTenantStatusChange}
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="tenant-tier">
                    Subscription Tier
                  </label>
                  <Select
                    id="tenant-tier"
                    value={selectedTenant.subscription_tier}
                    onChange={handleSelectedTenantTierChange}
                  >
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Professional</option>
                    <option value="business">Business</option>
                  </Select>
                </div>
                <div className="mt-6 flex gap-2">
                  <Button
                    onClick={async () => {
                      await handleSaveTenant(selectedTenant.id, {
                        subscription_status: selectedTenant.subscription_status,
                        subscription_tier: selectedTenant.subscription_tier,
                      });
                      setSelectedTenant(null);
                    }}
                    className="flex-1"
                  >
                    Save Changes
                  </Button>
                  <Button
                    onClick={() => setSelectedTenant(null)}
                    variant="secondary"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
        </Container>
      </main>
    </div>
  );
}
