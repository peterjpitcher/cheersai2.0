import Link from "next/link";
import { Calendar, Megaphone, Sparkles } from "lucide-react";
import Logo from "@/components/ui/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CheersAI - UK's Best Social Media Management for Pubs & Restaurants",
  description: "Transform your hospitality business with AI-powered social media management. Perfect for UK pubs, restaurants, and bars. Generate engaging content, schedule posts, and fill your venue every night. Free 14-day trial.",
  keywords: [
    "social media management UK hospitality",
    "pub social media scheduler",
    "restaurant content automation UK",
    "bar marketing software",
    "hospitality AI content generator",
    "UK pub marketing",
    "fill venue every night",
    "hospitality business growth"
  ].join(", "),
  openGraph: {
    title: "CheersAI - Fill Your Venue Every Night with AI-Powered Social Media",
    description: "UK's leading social media management platform for pubs, restaurants, and bars. AI-generated content that speaks your brand's language. Start free today!",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "CheersAI - Social Media Management for UK Hospitality",
      },
    ],
  },
  twitter: {
    title: "CheersAI - Social Media Management for UK Hospitality",
    description: "Fill your pub every night with AI-powered social media content. Built specifically for UK hospitality businesses.",
  },
};

export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "CheersAI",
    "applicationCategory": "Business Software",
    "operatingSystem": "Web Browser",
    "description": "AI-powered social media management platform specifically designed for UK hospitality businesses including pubs, restaurants, and bars. Generate engaging content, schedule posts automatically, and grow your business online.",
    "url": "https://cheersai.orangejelly.co.uk",
    "author": {
      "@type": "Organization",
      "name": "CheersAI"
    },
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "GBP",
      "description": "14-day free trial",
      "category": "Free Trial"
    },
    "featureList": [
      "AI-powered content generation",
      "Multi-platform social media scheduling",
      "UK hospitality-focused templates",
      "Brand voice training",
      "Analytics and reporting",
      "Team collaboration tools"
    ],
    "screenshot": "https://cheersai.orangejelly.co.uk/logo.png",
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.8",
      "ratingCount": "150"
    },
    "applicationSubCategory": "Social Media Management",
    "keywords": "social media management UK hospitality, pub social media scheduler, restaurant content automation UK, bar marketing software, hospitality AI content generator",
    "audience": {
      "@type": "Audience",
      "audienceType": "Hospitality Business Owners",
      "geographicArea": "United Kingdom"
    }
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="flex justify-center mb-12">
            <Logo variant="full" />
          </div>
          <h1 className="text-4xl md:text-5xl font-heading font-bold mb-4 text-text-primary">
            Fill Your Venue Every Night with AI-Powered Social Media
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto mb-8">
            The UK's leading social media management platform for pubs, restaurants, and bars. Create engaging content in seconds with AI that understands hospitality marketing.
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
            <h3 className="text-xl font-heading font-semibold mb-2">Smart Campaigns for Pubs & Restaurants</h3>
            <p className="text-text-secondary">
              Create event campaigns with perfectly timed posts. Built specifically for UK hospitality businesses. Upload once, publish everywhere.
            </p>
          </div>

          <div className="card text-center">
            <div className="flex justify-center mb-4">
              <Sparkles className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-heading font-semibold mb-2">Hospitality AI Content Generator</h3>
            <p className="text-text-secondary">
              Generate engaging content that matches your venue's unique voice and style. Trained specifically for UK pubs, restaurants, and bars.
            </p>
          </div>

          <div className="card text-center">
            <div className="flex justify-center mb-4">
              <Megaphone className="w-10 h-10 text-primary" />
            </div>
            <h3 className="text-xl font-heading font-semibold mb-2">Multi-Platform Publishing</h3>
            <p className="text-text-secondary">
              Reach your customers on Facebook, Instagram, Google My Business, and more. Perfect for busy hospitality owners.
            </p>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center mt-16 p-8 bg-primary/5 rounded-large">
          <h2 className="text-2xl font-heading font-bold mb-4">Ready to transform your hospitality business marketing?</h2>
          <p className="text-text-secondary mb-6">
            Join hundreds of UK pubs, restaurants, and bars already using CheersAI. 14-day free trial, no credit card required.
          </p>
          <Link href="/auth/signup" className="btn-primary">
            Start Your Free Trial Today
          </Link>
        </div>
      </div>
    </div>
    </>
  );
}
