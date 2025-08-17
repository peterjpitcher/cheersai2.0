import Link from "next/link";
import { Calendar, Megaphone, Sparkles } from "lucide-react";
import Logo from "@/components/ui/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home - AI-Powered Social Media Management | CheersAI",
  description: "Transform your social media strategy with CheersAI. Generate engaging content, schedule posts across multiple platforms, and grow your online presence with AI-powered tools.",
  openGraph: {
    title: "CheersAI - Transform Your Social Media Presence",
    description: "AI-powered content generation and scheduling for businesses. Manage all your social media from one place.",
  },
};

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="flex justify-center mb-8">
            <Logo variant="full" />
          </div>
          <h1 className="text-4xl md:text-5xl font-heading font-bold mb-4 text-text-primary">
            Welcome to CheersAI
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto mb-8">
            Create engaging content for your pub in seconds. AI-powered campaigns that speak your brand&apos;s language.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth/signup" className="btn-primary">
              Start Free Trial
            </Link>
            <Link href="/auth/login" className="btn-secondary">
              Sign In
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="card text-center">
            <div className="flex justify-center mb-4">
              <Calendar className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-heading font-semibold mb-2">Smart Campaigns</h3>
            <p className="text-text-secondary">
              Create event campaigns with perfectly timed posts. Upload once, publish everywhere.
            </p>
          </div>

          <div className="card text-center">
            <div className="flex justify-center mb-4">
              <Sparkles className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-heading font-semibold mb-2">AI-Powered</h3>
            <p className="text-text-secondary">
              Generate content that matches your pub&apos;s unique voice and style automatically.
            </p>
          </div>

          <div className="card text-center">
            <div className="flex justify-center mb-4">
              <Megaphone className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-heading font-semibold mb-2">Multi-Platform</h3>
            <p className="text-text-secondary">
              Reach your customers on Facebook, Instagram, and Google My Business.
            </p>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center mt-16 p-8 bg-primary/5 rounded-large">
          <h2 className="text-2xl font-heading font-bold mb-4">Ready to transform your pub&apos;s marketing?</h2>
          <p className="text-text-secondary mb-6">
            Join hundreds of pubs already using CheersAI. 14-day free trial, no credit card required.
          </p>
          <Link href="/auth/signup" className="btn-primary">
            Get Started Free
          </Link>
        </div>
      </div>
    </div>
  );
}
