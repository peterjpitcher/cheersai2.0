import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help & Support - CheersAI UK Hospitality Social Media Management",
  description: "Get help with CheersAI's social media management platform for UK pubs, restaurants, and bars. Video tutorials, guides, and support for hospitality business owners.",
  keywords: [
    "CheersAI help centre",
    "hospitality social media help UK",
    "pub marketing support",
    "restaurant social media tutorials",
    "bar marketing guides UK",
    "social media management help",
    "hospitality business support"
  ].join(", "),
  openGraph: {
    title: "Help & Support - CheersAI for UK Hospitality",
    description: "Get expert help with social media management for your pub, restaurant, or bar. Video tutorials, guides, and dedicated support from CheersAI.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
