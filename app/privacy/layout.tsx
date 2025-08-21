import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - CheersAI UK Hospitality Social Media Management",
  description: "Learn how CheersAI protects your privacy and handles data for UK hospitality businesses. Understand our privacy practices for our AI-powered social media management platform.",
  keywords: [
    "CheersAI privacy policy",
    "UK hospitality data protection",
    "social media privacy UK",
    "pub marketing privacy",
    "restaurant data security UK",
    "GDPR compliance hospitality software"
  ].join(", "),
  openGraph: {
    title: "Privacy Policy - CheersAI for UK Hospitality",
    description: "Privacy policy and data protection practices for CheersAI's social media management platform built for UK pubs, restaurants, and bars.",
  },
  robots: {
    index: true,
    follow: false,
  },
};

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}