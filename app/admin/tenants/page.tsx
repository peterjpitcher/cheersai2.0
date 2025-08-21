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
import Logo from "@/components/ui/logo";

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
      router.push("/auth/login");
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
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo />
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-warning" />
                <span className="text-sm font-medium text-warning">SUPERADMIN</span>
              </div>
            </div>
            <nav className="flex items-center gap-6">
              <Link href="/admin/dashboard" className="text-text-secondary hover:text-primary">
                Dashboard
              </Link>
              <Link href="/admin/tenants" className="text-primary font-medium">
                Tenants
              </Link>
              <Link href="/admin/users" className="text-text-secondary hover:text-primary">
                Users
              </Link>
              <Link href="/admin/content-settings" className="text-text-secondary hover:text-primary">
                Content Settings
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-heading font-bold mb-2">Tenant Management</h1>
          <p className="text-text-secondary">Manage all tenants in the system</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{tenants.length}</p>
                <p className="text-sm text-text-secondary">Total Tenants</p>
              </div>
              <Building className="w-8 h-8 text-primary" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {tenants.filter(t => t.subscription_status === 'active').length}
                </p>
                <p className="text-sm text-text-secondary">Active</p>
              </div>
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {tenants.filter(t => t.subscription_status === 'trial').length}
                </p>
                <p className="text-sm text-text-secondary">Trial</p>
              </div>
              <Clock className="w-8 h-8 text-warning" />
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {tenants.filter(t => t.subscription_tier === 'pro').length}
                </p>
                <p className="text-sm text-text-secondary">Pro Tier</p>
              </div>
              <CreditCard className="w-8 h-8 text-primary" />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-6">
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
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Tenants Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface border-b border-border">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Tenant</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Tier</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-text-secondary">Users</th>
                  <th className="text-center py-3 px-4 font-medium text-text-secondary">Campaigns</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Trial Ends</th>
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
                      <span className={`badge-${getTierColor(tenant.subscription_tier)}`}>
                        {tenant.subscription_tier}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge-${getStatusColor(tenant.subscription_status)}`}>
                        {tenant.subscription_status}
                      </span>
                    </td>
                    <td className="text-center py-3 px-4">
                      {tenant.users?.[0]?.count || 0}
                    </td>
                    <td className="text-center py-3 px-4">
                      {tenant.campaigns?.[0]?.count || 0}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {tenant.trial_ends_at ? 
                        new Date(tenant.trial_ends_at).toLocaleDateString('en-GB') : 
                        '-'
                      }
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {new Date(tenant.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/tenants/${tenant.id}`}
                          className="p-2 hover:bg-background rounded-medium"
                          title="View Details"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => setSelectedTenant(tenant)}
                          className="p-2 hover:bg-background rounded-medium"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(tenant.id)}
                          className="p-2 hover:bg-background rounded-medium"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredTenants.length === 0 && (
            <div className="text-center py-12 text-text-secondary">
              <Building className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No tenants found</p>
            </div>
          )}
        </div>

        {/* Edit Modal */}
        {selectedTenant && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-large p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-heading font-bold mb-4">Edit Tenant</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Subscription Status</label>
                  <select
                    value={selectedTenant.subscription_status}
                    onChange={(e) => setSelectedTenant({
                      ...selectedTenant,
                      subscription_status: e.target.value
                    })}
                    className="input-field w-full"
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Subscription Tier</label>
                  <select
                    value={selectedTenant.subscription_tier}
                    onChange={(e) => setSelectedTenant({
                      ...selectedTenant,
                      subscription_tier: e.target.value
                    })}
                    className="input-field w-full"
                  >
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="business">Business</option>
                  </select>
                </div>
                <div className="flex gap-2 mt-6">
                  <button
                    onClick={async () => {
                      await handleUpdateStatus(selectedTenant.id, selectedTenant.subscription_status);
                      setSelectedTenant(null);
                    }}
                    className="btn-primary flex-1"
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => setSelectedTenant(null)}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}