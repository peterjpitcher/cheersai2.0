import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | CheersAI - UK Hospitality Social Media Management",
    default: "Sign In - UK Hospitality Social Media Management | CheersAI",
  },
  description: "Sign in to your CheersAI account to manage your pub, restaurant, or bar's social media presence with AI-powered content generation and scheduling tools built for UK hospitality businesses.",
  keywords: [
    "CheersAI login",
    "hospitality social media login",
    "pub marketing login UK",
    "restaurant social media management signin",
    "bar marketing software login"
  ].join(", "),
  openGraph: {
    title: "Sign In to CheersAI - UK Hospitality Social Media Management",
    description: "Access your AI-powered social media management dashboard. Built specifically for UK pubs, restaurants, and bars.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}