import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | CheersAI",
    default: "Authentication",
  },
  description: "Sign in or create an account to start managing your social media with AI-powered tools.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}