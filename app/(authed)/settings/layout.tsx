import type { Metadata } from "next";

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
  return children;
}