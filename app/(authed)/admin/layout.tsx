import { redirect } from "next/navigation";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import Container from "@/components/layout/container";
import { AppShell } from "@/components/app-shell/app-shell";
import { getAuthWithCache } from "@/lib/supabase/auth-cache";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getAuthWithCache();

  if (!user) {
    redirect("/");
  }

  let isSuperadmin = false;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .single();
    isSuperadmin = Boolean(data?.is_superadmin);
  } catch (error) {
    logger.warn("admin layout superadmin check failed", {
      area: "auth",
      op: "admin.guard",
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }

  if (!isSuperadmin) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      <SidebarNav base="/admin" preset="admin" />
      <AppShell>
        <Container className="pb-page-pb pt-page-pt">
          {children}
        </Container>
      </AppShell>
    </div>
  );
}
