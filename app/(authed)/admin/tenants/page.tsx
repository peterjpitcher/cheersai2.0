"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Building, Users, CreditCard, Calendar, Shield,
  Search, Filter, ChevronRight, Edit2, Trash2,
  CheckCircle, XCircle, Clock
} from "lucide-react";
import Link from "next/link";
import Container from "@/components/layout/container";
import { formatDate } from "@/lib/datetime";
import Logo from "@/components/ui/logo";
import { Card } from "@/components/ui/card";
import { formatPlanLabel } from "@/lib/copy";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  subscription_status: string;
  trial_ends_at: string;
  created_at: string;
  updated_at: string;
  users?: any[];
  campaigns?: any[];
}

export default function TenantsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    checkAuthorization();
  }, []);

  const checkAuthorization = async () => {
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
  };

  const fetchTenants = async () => {
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
  };

  const handleUpdateStatus = async (tenantId: string, newStatus: string) => {
    const supabase = createClient();
    
    try {
      const { error } = await supabase
        .from("tenants")
        .update({
          subscription_status: newStatus,
          updated_at: new Date().toISOString()
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

  const filteredTenants = tenants.filter(tenant => {
    const matchesSearch = tenant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          tenant.slug.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || tenant.subscription_status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'trial': return 'warning';
      case 'cancelled': return 'error';
      default: return 'secondary';
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'pro': return 'primary';
      case 'business': return 'success';
      default: return 'secondary';
    }
  };

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
        <Container className="section-y">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo />
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
        <Container className="section-y">
        <div className="mb-8">
          <h1 className="text-3xl font-heading font-bold mb-2">Tenant Management</h1>
          <p className="text-text-secondary">Manage all tenants in the system</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{tenants.length}</p>
                <p className="text-sm text-text-secondary">Total Tenants</p>
              </div>
              <Building className="w-8 h-8 text-primary" />
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
              <CheckCircle className="w-8 h-8 text-success" />
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
              <Clock className="w-8 h-8 text-warning" />
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
              <CreditCard className="w-8 h-8 text-primary" />
            </div>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-6">
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
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value)}
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
              <TableHeader className="bg-surface border-b border-border">
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
                      <span className={`badge-${getTierColor(tenant.subscription_tier)}`}>
                        {formatPlanLabel(tenant.subscription_tier)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`badge-${getStatusColor(tenant.subscription_status)}`}>
                        {tenant.subscription_status}
                      </span>
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
                          className="p-2 hover:bg-background rounded-medium"
                          title="View Details"
                          aria-label={`View details for ${tenant.name}`}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => setSelectedTenant(tenant)}
                          className="p-2 hover:bg-background rounded-medium"
                          title="Edit"
                          aria-label={`Edit ${tenant.name}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(tenant.id)}
                          className="p-2 hover:bg-background rounded-medium"
                          title="Delete"
                          aria-label={`Delete ${tenant.name}`}
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredTenants.length === 0 && (
            <div className="text-center py-12 text-text-secondary">
              <Building className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No tenants found</p>
            </div>
          )}
        </Card>

        {/* Edit Modal */}
        {selectedTenant && (
          <Dialog open={!!selectedTenant} onOpenChange={(o)=>{ if(!o) setSelectedTenant(null); }}>
            <DialogContent className="max-w-md p-0">
              <DialogHeader className="px-6 py-4">
                <DialogTitle className="text-xl font-heading">Edit Tenant</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 px-6 pb-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Subscription Status</label>
                  <Select
                    value={selectedTenant.subscription_status}
                    onChange={(e) => setSelectedTenant({
                      ...selectedTenant,
                      subscription_status: (e.target as HTMLSelectElement).value
                    })}
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Subscription Tier</label>
                  <Select
                    value={selectedTenant.subscription_tier}
                    onChange={(e) => setSelectedTenant({
                      ...selectedTenant,
                      subscription_tier: (e.target as HTMLSelectElement).value
                    })}
                  >
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Professional</option>
                    <option value="business">Business</option>
                  </Select>
                </div>
                <div className="flex gap-2 mt-6">
                  <Button
                    onClick={async () => {
                      await handleUpdateStatus(selectedTenant.id, selectedTenant.subscription_status);
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
