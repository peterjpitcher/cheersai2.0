import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start Free Trial - Social Media Management for UK Hospitality",
  description: "Start your free 14-day trial of CheersAI. No credit card required. Transform your pub, restaurant, or bar's social media with AI-powered content generation and smart scheduling.",
  keywords: [
    "CheersAI free trial",
    "hospitality social media trial UK",
    "pub marketing free trial",
    "restaurant social media signup",
    "bar marketing software trial",
    "free hospitality marketing tools",
    "14 day free trial UK"
  ].join(", "),
  openGraph: {
    title: "Start Free Trial - CheersAI for UK Hospitality Businesses",
    description: "Transform your hospitality business with AI-powered social media management. 14-day free trial, no credit card required. Built for UK pubs, restaurants, and bars.",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "CheersAI Free Trial - Social Media Management for UK Hospitality",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}