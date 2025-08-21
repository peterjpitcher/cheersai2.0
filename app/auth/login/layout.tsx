import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In - Access Your Hospitality Social Media Dashboard",
  description: "Sign in to CheersAI to manage your pub, restaurant, or bar's social media with AI-powered content generation. Access your campaigns, scheduled posts, and analytics dashboard.",
  keywords: [
    "CheersAI sign in",
    "hospitality social media login",
    "pub marketing dashboard access",
    "restaurant social media signin",
    "bar marketing login UK"
  ].join(", "),
  openGraph: {
    title: "Sign In to CheersAI - UK Hospitality Social Media Management",
    description: "Access your social media management dashboard built for UK hospitality businesses. Generate content, schedule posts, and grow your business online.",
  },
  robots: {
    index: true,
    follow: false,
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}