import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard - Manage Your Social Media | CheersAI",
  description: "Access your CheersAI dashboard to manage campaigns, view analytics, schedule posts, and monitor your social media performance across all platforms.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}