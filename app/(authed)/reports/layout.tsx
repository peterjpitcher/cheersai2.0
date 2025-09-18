import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { AppShell } from "@/components/app-shell/app-shell";
import Container from "@/components/layout/container";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SidebarNav base="/reports" preset="reports" />
      <AppShell>
        <Container className="pb-page-pb pt-page-pt">{children}</Container>
      </AppShell>
    </>
  );
}

