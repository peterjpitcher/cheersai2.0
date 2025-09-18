import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import Container from "@/components/layout/container";
import { AppShell } from "@/components/app-shell/app-shell";

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SidebarNav base="/media" preset="media" />
      <AppShell>
        <Container className="pb-page-pb pt-page-pt">
{children}
        </Container>
      </AppShell>
    </div>
  );
}
