import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

interface TenantUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

interface TenantCampaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface TenantPost {
  id: string;
  platform: string;
  status: string;
  created_at: string;
}

interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  subscription_status: string;
  subscription_tier: string | null;
  created_at: string;
  total_campaigns_created?: number | null;
  users: TenantUser[] | null;
  campaigns: TenantCampaign[] | null;
  posts: TenantPost[] | null;
}

interface TenantDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: TenantDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Check admin access
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: currentUser } = await supabase
    .from("users")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!currentUser || currentUser.role !== "super_admin") {
    redirect("/dashboard");
  }

  // Fetch tenant details
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select(`
      *,
      users:users!tenant_id (
        id,
        email,
        first_name,
        last_name,
        role,
        created_at,
        last_sign_in_at
      ),
      campaigns:campaigns!tenant_id (
        id,
        name,
        status,
        created_at
      ),
      posts:campaign_posts!tenant_id (
        id,
        platform,
        status,
        created_at
      )
    `)
    .eq("id", id)
    .single<TenantRecord>();

  if (error || !tenant) {
    notFound();
  }

  const tenantUsers: TenantUser[] = tenant.users ?? [];
  const tenantCampaigns: TenantCampaign[] = tenant.campaigns ?? [];
  const tenantPosts: TenantPost[] = tenant.posts ?? [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6">
        <Link
          href="/admin/tenants"
          className="mb-4 inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="size-4" />
          Back to Tenants
        </Link>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-text-secondary">Tenant Details & Management</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Basic Info */}
        <div className="rounded-large border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">Basic Information</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-text-secondary">Name</p>
              <p className="font-medium">{tenant.name}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Slug</p>
              <p className="font-mono text-sm">{tenant.slug}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Status</p>
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                  tenant.subscription_status === "active"
                    ? "bg-success/10 text-success"
                    : tenant.subscription_status === "trial"
                      ? "bg-warning/10 text-warning"
                      : "bg-destructive/10 text-destructive"
                }`}
              >
                {tenant.subscription_status}
              </span>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Plan</p>
              <p className="capitalize">{tenant.subscription_tier || "Free"}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Created</p>
              <p className="text-sm">{formatDate(tenant.created_at)}</p>
            </div>
          </div>
        </div>

        {/* Usage Stats */}
        <div className="rounded-large border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">Usage Statistics</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-text-secondary">Users</p>
              <p className="text-2xl font-semibold">{tenantUsers.length}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Campaigns</p>
              <p className="text-2xl font-semibold">{tenantCampaigns.length}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Posts</p>
              <p className="text-2xl font-semibold">{tenantPosts.length}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Trial Campaigns Used</p>
              <p className="text-lg">{tenant.total_campaigns_created ?? 0}</p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-large border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">Quick Actions</h2>
          <div className="space-y-2">
            <button className="w-full rounded-chip px-3 py-2 text-left text-sm hover:bg-background">
              View Campaigns
            </button>
            <button className="w-full rounded-chip px-3 py-2 text-left text-sm hover:bg-background">
              View Users
            </button>
            <button className="w-full rounded-chip px-3 py-2 text-left text-sm hover:bg-background">
              Usage Reports
            </button>
            <hr className="my-3" />
            <button className="w-full rounded-chip px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
              Suspend Tenant
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      {tenantUsers.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-medium">Team Members</h2>
          <div className="overflow-hidden rounded-large border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-medium">User</th>
                    <th className="px-6 py-3 text-left text-sm font-medium">Role</th>
                    <th className="px-6 py-3 text-left text-sm font-medium">Joined</th>
                    <th className="px-6 py-3 text-left text-sm font-medium">Last Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tenantUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium">
                            {user.first_name} {user.last_name}
                          </p>
                          <p className="text-sm text-text-secondary">{user.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {user.last_sign_in_at ? formatDate(user.last_sign_in_at) : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
