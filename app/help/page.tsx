"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, Search, BookOpen, MessageCircle, 
  Video, FileText, HelpCircle, Mail, ChevronRight,
  Sparkles, Calendar, Image, Settings, Shield, CreditCard
} from "lucide-react";

const helpCategories = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Sparkles,
    articles: [
      { title: "Welcome to CheersAI", slug: "welcome" },
      { title: "Setting up your brand profile", slug: "brand-setup" },
      { title: "Connecting social accounts", slug: "social-connections" },
      { title: "Creating your first campaign", slug: "first-campaign" }
    ]
  },
  {
    id: "campaigns",
    title: "Campaigns",
    icon: Calendar,
    articles: [
      { title: "Understanding campaign types", slug: "campaign-types" },
      { title: "AI content generation", slug: "ai-generation" },
      { title: "Scheduling posts", slug: "scheduling" },
      { title: "Managing multiple campaigns", slug: "multiple-campaigns" }
    ]
  },
  {
    id: "media",
    title: "Media Library",
    icon: Image,
    articles: [
      { title: "Uploading images", slug: "upload-images" },
      { title: "Organizing media", slug: "organize-media" },
      { title: "Image requirements", slug: "image-requirements" },
      { title: "Stock photos", slug: "stock-photos" }
    ]
  },
  {
    id: "settings",
    title: "Settings & Account",
    icon: Settings,
    articles: [
      { title: "Brand voice training", slug: "brand-voice" },
      { title: "Multi-location setup", slug: "locations" },
      { title: "Team management", slug: "team" },
      { title: "Notifications", slug: "notifications" }
    ]
  },
  {
    id: "billing",
    title: "Billing & Plans",
    icon: CreditCard,
    articles: [
      { title: "Subscription plans", slug: "plans" },
      { title: "Managing your subscription", slug: "subscription" },
      { title: "Payment methods", slug: "payments" },
      { title: "Invoices and receipts", slug: "invoices" }
    ]
  },
  {
    id: "security",
    title: "Security & Privacy",
    icon: Shield,
    articles: [
      { title: "Data protection", slug: "data-protection" },
      { title: "Two-factor authentication", slug: "2fa" },
      { title: "API access", slug: "api-access" },
      { title: "GDPR compliance", slug: "gdpr" }
    ]
  }
];

const popularArticles = [
  { title: "How to create an AI-powered campaign", category: "campaigns", slug: "ai-generation" },
  { title: "Connecting Facebook and Instagram", category: "getting-started", slug: "social-connections" },
  { title: "Training your brand voice", category: "settings", slug: "brand-voice" },
  { title: "Understanding analytics", category: "campaigns", slug: "analytics-guide" },
  { title: "Troubleshooting connection issues", category: "getting-started", slug: "connection-issues" }
];

export default function HelpCenterPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredCategories = searchQuery
    ? helpCategories.filter(cat =>
        cat.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cat.articles.some(article =>
          article.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      )
    : helpCategories;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-text-secondary hover:text-primary">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold">Help Center</h1>
              <p className="text-sm text-text-secondary">
                Find answers and learn how to use CheersAI
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-primary/10 to-background py-12">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-heading font-bold mb-4">
              How can we help you today?
            </h2>
            <p className="text-text-secondary mb-8">
              Search our knowledge base or browse categories below
            </p>
            
            {/* Search Bar */}
            <div className="relative max-w-2xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for help articles..."
                className="input-field pl-12 py-4 text-lg"
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid md:grid-cols-3 gap-4">
            <Link href="/help/contact" className="card-interactive text-center">
              <MessageCircle className="w-8 h-8 text-primary mx-auto mb-2" />
              <h3 className="font-semibold">Contact Support</h3>
              <p className="text-sm text-text-secondary mt-1">Get help from our team</p>
            </Link>
            
            <Link href="/help/videos" className="card-interactive text-center">
              <Video className="w-8 h-8 text-primary mx-auto mb-2" />
              <h3 className="font-semibold">Video Tutorials</h3>
              <p className="text-sm text-text-secondary mt-1">Learn with video guides</p>
            </Link>
            
            <Link href="/help/docs" className="card-interactive text-center">
              <FileText className="w-8 h-8 text-primary mx-auto mb-2" />
              <h3 className="font-semibold">Documentation</h3>
              <p className="text-sm text-text-secondary mt-1">Read detailed guides</p>
            </Link>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Popular Articles */}
        {!searchQuery && !selectedCategory && (
          <section className="mb-12">
            <h3 className="text-xl font-heading font-bold mb-6">Popular Articles</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {popularArticles.map((article, index) => (
                <Link
                  key={index}
                  href={`/help/${article.category}/${article.slug}`}
                  className="card-interactive group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium group-hover:text-primary transition-colors">
                        {article.title}
                      </p>
                      <p className="text-sm text-text-secondary capitalize mt-1">
                        {article.category.replace('-', ' ')}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-text-secondary group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Categories */}
        <section>
          <h3 className="text-xl font-heading font-bold mb-6">Browse by Category</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCategories.map((category) => {
              const Icon = category.icon;
              return (
                <div key={category.id} className="card">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="bg-primary/10 p-2 rounded-medium">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h4 className="font-semibold text-lg">{category.title}</h4>
                  </div>
                  
                  <ul className="space-y-2">
                    {category.articles.slice(0, 4).map((article, index) => (
                      <li key={index}>
                        <Link
                          href={`/help/${category.id}/${article.slug}`}
                          className="text-sm text-text-secondary hover:text-primary flex items-center gap-2 group"
                        >
                          <span className="w-1 h-1 bg-text-secondary rounded-full" />
                          {article.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  
                  {category.articles.length > 4 && (
                    <Link
                      href={`/help/${category.id}`}
                      className="text-sm text-primary hover:underline mt-3 inline-block"
                    >
                      View all {category.articles.length} articles →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Contact Section */}
        <section className="mt-12 card bg-primary/5 border-primary/20">
          <div className="text-center">
            <HelpCircle className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="text-xl font-heading font-bold mb-2">
              Still need help?
            </h3>
            <p className="text-text-secondary mb-6">
              Our support team is here to assist you
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/help/contact" className="btn-primary">
                <Mail className="w-4 h-4 mr-2" />
                Contact Support
              </Link>
              <Link href="/help/chat" className="btn-secondary">
                <MessageCircle className="w-4 h-4 mr-2" />
                Start Live Chat
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}