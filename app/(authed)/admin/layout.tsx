import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import Container from "@/components/layout/container";
import { AppShell } from "@/components/app-shell/app-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SidebarNav base="/admin" preset="admin" />
      <AppShell>
        <Container className="pt-page-pt pb-page-pb">
          {children}
        </Container>
      </AppShell>
    </div>
  );
}
