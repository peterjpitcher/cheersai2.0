import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - CheersAI UK Hospitality Social Media Management",
  description: "Read CheersAI's Terms of Service for UK hospitality businesses. Understand your rights and responsibilities when using our AI-powered social media management platform for pubs, restaurants, and bars.",
  keywords: [
    "CheersAI terms of service",
    "UK hospitality software terms",
    "social media management terms",
    "pub marketing software legal",
    "restaurant marketing terms UK"
  ].join(", "),
  openGraph: {
    title: "Terms of Service - CheersAI for UK Hospitality",
    description: "Terms and conditions for using CheersAI's social media management platform built for UK pubs, restaurants, and bars.",
  },
  robots: {
    index: true,
    follow: false,
  },
};

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}