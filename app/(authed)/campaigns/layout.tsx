import Container from '@/components/layout/container';
import { AppShell } from "@/components/app-shell/app-shell";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SidebarNav base="/campaigns" preset="campaignsRoot" />
      <AppShell>
        <Container className="pb-page-pb pt-page-pt">{children}</Container>
      </AppShell>
    </>
  );
}
