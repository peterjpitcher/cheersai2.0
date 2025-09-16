import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { AppShell } from "@/components/app-shell/app-shell";
import Container from "@/components/layout/container";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SidebarNav base="/reports" preset="reports" />
      <AppShell>
        <Container className="pt-page-pt pb-page-pb">{children}</Container>
      </AppShell>
    </>
  );
}

