import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Campaigns - Social Media Campaign Management | CheersAI",
  description: "Create, manage, and track your social media campaigns. Use AI to generate engaging content and schedule posts across multiple platforms.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}