import type { Metadata } from "next";
import { SettingsNav } from "@/components/settings/nav";

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
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-heading font-bold mb-8">Settings</h1>
          
          <div className="flex flex-col md:flex-row gap-8">
            <SettingsNav />
            
            <main className="flex-1 min-w-0">
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}