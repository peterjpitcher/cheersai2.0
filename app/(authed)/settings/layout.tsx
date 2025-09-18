import type { Metadata } from "next";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import Container from "@/components/layout/container";
import { AppShell } from "@/components/app-shell/app-shell";

export const metadata: Metadata = {
  title: "Settings - Account & Preferences | CheersAI",
  description: "Manage your CheersAI account settings, billing, integrations, and notification preferences.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SidebarNav base="/settings" preset="settings" />
      <AppShell>
        <Container className="pb-page-pb pt-page-pt">
          {children}
        </Container>
      </AppShell>
    </div>
  );
}
