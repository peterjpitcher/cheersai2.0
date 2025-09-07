import type { Metadata } from "next";
import SubNav from "@/components/navigation/sub-nav";

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
      {/* Section SubNav under the global HeroNav */}
      <SubNav base="/settings" preset="settings" />
      <main className="container mx-auto px-4 max-w-screen-2xl py-8">
        {children}
      </main>
    </div>
  );
}
