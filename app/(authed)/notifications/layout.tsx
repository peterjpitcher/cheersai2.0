import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { AppShell } from "@/components/app-shell/app-shell";
import Container from "@/components/layout/container";

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SidebarNav base="/notifications" preset="notifications" />
      <AppShell>
        <Container className="pt-page-pt pb-page-pb">{children}</Container>
      </AppShell>
    </>
  );
}

