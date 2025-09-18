import Link from "next/link";
import { Calendar, Megaphone, Sparkles, Clock, TrendingUp, Users, Zap, CheckCircle, ArrowRight, MessageSquare, BarChart, Shield } from "lucide-react";
import BrandLogo from "@/components/ui/BrandLogo";
import Container from "@/components/layout/container";
import type { Metadata } from "next";
import WaitlistForm from "@/components/waitlist/form";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://cheersai.uk'

export const metadata: Metadata = {
  title: "CheersAI - AI Social Media Management for UK Pubs, Restaurants & Bars | Free Trial",
  description: "Transform your UK hospitality marketing with AI‑powered social media. Automate posts for Facebook, Instagram & more. Save hours each week. Create engaging content in seconds. Built for pubs, restaurants, bars & cafes. Start your 14‑day free trial – no card required.",
  keywords: [
    "social media management UK hospitality",
    "pub social media scheduler UK",
    "restaurant marketing software UK", 
    "bar social media automation",
    "hospitality AI content generator",
    "UK pub marketing tool",
    "restaurant social media manager",
    "automated pub marketing",
    "increase pub footfall",
    "fill restaurant tables",
    "hospitality marketing automation UK",
    "social media for UK pubs",
    "Facebook Instagram scheduler hospitality",
    "pub quiz promotion tool",
    "restaurant event marketing UK",
    "gastropub social media",
    "cocktail bar marketing software",
    "British pub marketing platform",
    "hospitality content calendar UK",
    "AI marketing for pubs"
  ].join(", "),
  openGraph: {
    title: "CheersAI – AI Social Media for UK Hospitality",
    description: "AI social media management for UK pubs, restaurants and bars. Create on‑brand posts, schedule across platforms, and save hours each week. Free 14‑day trial.",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "CheersAI - AI-Powered Social Media Management for UK Hospitality",
      },
    ],
    type: "website",
    locale: "en_GB",
    siteName: "CheersAI",
  },
  // Removed Twitter card metadata
  alternates: {
    canonical: SITE_URL,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "CheersAI",
      "applicationCategory": "Business Software",
      "operatingSystem": "Web Browser",
      "description": "AI-powered social media management platform specifically designed for UK hospitality businesses. Automate your pub, restaurant, bar or cafe marketing. Create engaging posts in seconds, schedule across all platforms, increase footfall and fill tables every night.",
      "url": SITE_URL,
      "author": {
        "@type": "Organization",
        "name": "CheersAI",
        "url": SITE_URL
      },
      "offers": [
        {
          "@type": "Offer",
          "name": "Free Trial",
          "price": "0",
          "priceCurrency": "GBP",
          "description": "14-day free trial - no credit card required",
          "eligibleDuration": {
            "@type": "QuantitativeValue",
            "value": 14,
            "unitCode": "DAY"
          }
        },
        {
          "@type": "Offer",
          "name": "Starter Plan",
          "price": "29.00",
          "priceCurrency": "GBP",
          "description": "Perfect for independent pubs and cafes"
        },
        {
          "@type": "Offer", 
          "name": "Professional Plan",
          "price": "44.99",
          "priceCurrency": "GBP",
          "description": "Ideal for busy restaurants and gastropubs"
        }
      ],
      "featureList": [
        "AI content generation trained for UK hospitality",
        "Multi-platform scheduling (Facebook, Instagram, Google Business Profile)",
        "Brand voice customisation",
        "Event campaign automation",
        "Pub quiz and special offers promotion",
        "Team collaboration tools",
        "UK-specific templates and content ideas"
      ],
      "screenshot": `${SITE_URL}/logo.png`,
      "applicationSubCategory": "Social Media Management Software",
      "keywords": "pub marketing software UK, restaurant social media automation, bar marketing tool, hospitality content scheduler, AI social media UK pubs",
      "audience": {
        "@type": "Audience",
        "audienceType": "UK Hospitality Business Owners",
        "geographicArea": {
          "@type": "Country",
          "name": "United Kingdom"
        }
      },
      "availableLanguage": "en-GB",
      "requirements": "Modern web browser, active social media business accounts"
    },
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "CheersAI",
      "description": "AI-powered social media management for UK pubs, restaurants and bars",
      "url": SITE_URL,
      "logo": `${SITE_URL}/logo.png`,
      "areaServed": [
        {
          "@type": "Country",
          "name": "United Kingdom"
        }
      ],
      "makesOffer": [
        {
          "@type": "Offer",
          "itemOffered": {
            "@type": "Service",
            "name": "Social Media Management for Hospitality",
            "description": "Automated social media marketing for pubs, restaurants, bars and cafes"
          }
        }
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How much time can CheersAI save my pub or restaurant?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Venues typically save hours each week with CheersAI. Our AI drafts engaging posts in seconds, schedules them across platforms, and keeps your calendar full – freeing you to focus on guests."
          }
        },
        {
          "@type": "Question",
          "name": "Which social media platforms does CheersAI support for UK hospitality?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "CheersAI supports the platforms where your customers are: Facebook, Instagram, and Google Business Profile. LinkedIn is coming soon. Post once and publish everywhere with platform‑optimised content."
          }
        },
        {
          "@type": "Question",
          "name": "Is CheersAI suitable for small independent pubs?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes. CheersAI is designed for independent pubs, restaurants and bars. The Starter plan includes AI content creation and multi‑platform scheduling so smaller venues can compete with larger chains."
          }
        },
        {
          "@type": "Question",
          "name": "Do I need a credit card for the free trial?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "No. Start a 14‑day free trial without a credit card. You can upgrade any time from within the app."
          }
        },
        {
          "@type": "Question",
          "name": "Will posts go live without my approval?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "You are in control. Approve posts before publishing or enable scheduling for trusted campaigns."
          }
        },
        {
          "@type": "Question",
          "name": "Can CheersAI help promote pub quizzes and special events?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes! CheersAI excels at event promotion. Create entire campaigns for pub quizzes, live music nights, seasonal menus, or special offers. Our AI understands UK hospitality events and generates perfectly-timed posts to maximise attendance."
          }
        },
        {
          "@type": "Question",
          "name": "Do I need technical skills to use CheersAI?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Not at all. CheersAI is built for busy hospitality professionals, not tech experts. If you can use Facebook, you can use CheersAI. Our simple interface and AI assistant handle all the complex work for you."
          }
        }
      ]
    }
  ];

  return (
    <>
      {structuredData.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}
      
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        {/* Simple Marketing Header */}
        <header className="border-b border-border bg-surface/50 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
          <Container className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <BrandLogo variant="icon" />
              <span className="font-heading font-bold">CheersAI</span>
            </div>
            <nav className="hidden items-center gap-6 text-sm md:flex" aria-label="Primary">
              <Link href="/features" className="text-text-secondary hover:text-primary">Features</Link>
              <Link href="/pricing" className="text-text-secondary hover:text-primary">Pricing</Link>
              <Link href="/help" className="text-text-secondary hover:text-primary">Help</Link>
            </nav>
            <div className="flex gap-2">
              <Link href="/auth/login" className="rounded-md border border-input px-3 py-2 text-sm">Sign In</Link>
              <Link href="/#waitlist" className="rounded-md bg-primary px-3 py-2 text-sm text-white">Join Waitlist</Link>
            </div>
          </Container>
        </header>
        {/* Hero Section with Trust Signals */}
        <section>
          <Container className="py-12 md:py-20">
          <div className="mb-16 text-center">
            <div className="mb-8 flex justify-center">
              <BrandLogo variant="auth" />
            </div>
            
            {/* Trust signals (no inflated claims) */}
            <div className="mb-8 flex flex-wrap justify-center gap-3 md:gap-4">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                <Shield className="mr-1 size-4" /> Built for UK hospitality
              </span>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                <Sparkles className="mr-1 size-4" /> British English & UK templates
              </span>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                <Clock className="mr-1 size-4" /> Save hours every week
              </span>
            </div>

            <h1 className="mb-6 font-heading text-4xl font-bold text-text-primary md:text-6xl">
              AI Social Media Management for <br className="hidden md:block" />
              <span className="text-primary">UK Pubs, Restaurants & Bars</span>
            </h1>
            
            <p className="mx-auto mb-8 max-w-3xl text-xl text-text-secondary md:text-2xl">
              Spend less time on socials and more time serving guests. CheersAI creates on‑brand posts, plans your calendar, and publishes at the right time.
            </p>
            
            <div className="mb-6 flex flex-col justify-center gap-4 sm:flex-row">
              <Link href="/#waitlist" className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-4 text-lg text-white">
                Join the Waitlist
                <ArrowRight className="ml-2 inline size-5" />
              </Link>
              <Link href="/auth/login" className="inline-flex items-center justify-center rounded-md border border-input px-8 py-4 text-lg">
                Sign In
              </Link>
            </div>
            
            <div id="waitlist" className="mx-auto mt-8 max-w-xl">
              <WaitlistForm />
            </div>
          </div>
          </Container>
        </section>

        {/* Problem/Solution Section */}
        <section>
          <Container className="py-12">
          <div className="mx-auto mb-12 max-w-4xl rounded-2xl bg-white/50 p-6 md:p-8">
            <h2 className="mb-12 text-center font-heading text-3xl font-bold md:text-4xl">
              Social Media Shouldn’t Take Hours Every Day
            </h2>
            
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <h3 className="mb-4 text-xl font-semibold text-red-600">❌ Without CheersAI</h3>
                <ul className="space-y-3 text-text-secondary">
                  <li>• Spend 2+ hours daily creating posts</li>
                  <li>• Struggle with what to post</li>
                  <li>• Miss peak engagement times</li>
                  <li>• Inconsistent posting schedule</li>
                  <li>• Generic content that doesn't convert</li>
                </ul>
              </div>
              
              <div>
                <h3 className="mb-4 text-xl font-semibold text-green-600">✅ With CheersAI</h3>
                <ul className="space-y-3 text-text-secondary">
                  <li>• Create a month’s content in minutes</li>
                  <li>• AI suggests perfect hospitality content</li>
                  <li>• Auto-publish at optimal times</li>
                  <li>• Consistent brand presence online</li>
                  <li>• Posts that actually fill seats</li>
                </ul>
              </div>
            </div>
          </div>
          </Container>
        </section>

        {/* Enhanced Features Grid */}
        <section>
          <Container className="py-12">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold md:text-4xl">
            Everything You Need to Market Your Hospitality Business
          </h2>
          <p className="mx-auto mb-12 max-w-3xl text-center text-xl text-text-secondary">
            Purpose-built features for UK pubs, restaurants, bars, and cafes
          </p>
          
          <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-3">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-lg">
              <div className="mb-4 flex justify-center">
                <Calendar className="size-12 text-primary" />
              </div>
              <h3 className="mb-3 font-heading text-xl font-semibold">Event Campaign Automation</h3>
              <p className="mb-4 text-text-secondary">
                Pub quiz? Live music? Sunday roast? Create complete campaigns with countdown posts, reminders, and follow-ups. All scheduled automatically.
              </p>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>✓ Quiz night templates</li>
                <li>✓ Special offer campaigns</li>
                <li>✓ Seasonal menu launches</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-lg">
              <div className="mb-4 flex justify-center">
                <Sparkles className="size-12 text-primary" />
              </div>
              <h3 className="mb-3 font-heading text-xl font-semibold">UK Hospitality AI Writer</h3>
              <p className="mb-4 text-text-secondary">
                Our AI understands British pubs and restaurants. Generate posts about bank holidays, match days, and local events that resonate with your community.
              </p>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>✓ British spelling & terminology</li>
                <li>✓ Local area knowledge</li>
                <li>✓ Venue personality matching</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-lg">
              <div className="mb-4 flex justify-center">
                <Megaphone className="size-12 text-primary" />
              </div>
              <h3 className="mb-3 font-heading text-xl font-semibold">Multi-Platform Publishing</h3>
              <p className="mb-4 text-text-secondary">
                Post to Facebook, Instagram & Google Business Profile from one dashboard. Each platform gets optimised content - hashtags, emojis, and formatting. LinkedIn is coming soon.
              </p>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>✓ Platform‑specific optimisation</li>
                <li>✓ Best time scheduling</li>
                <li>✓ Google Business Profile (coming soon)</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-lg">
              <div className="mb-4 flex justify-center">
                <Clock className="size-12 text-primary" />
              </div>
              <h3 className="mb-3 font-heading text-xl font-semibold">Smart Scheduling</h3>
              <p className="mb-4 text-text-secondary">
                Set your posting schedule once. CheersAI publishes when your customers are most active - lunch rushes, after work, weekend planning times.
              </p>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>✓ Peak time auto-posting</li>
                <li>✓ Timezone-aware for UK</li>
                <li>✓ Holiday adjustments</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-lg">
              <div className="mb-4 flex justify-center">
                <MessageSquare className="size-12 text-primary" />
              </div>
              <h3 className="mb-3 font-heading text-xl font-semibold">Brand Voice Training</h3>
              <p className="mb-4 text-text-secondary">
                Gastropub? Sports bar? Fine dining? Train the AI on your unique style. Every post sounds authentically you, not generic marketing speak.
              </p>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>✓ Tone customisation</li>
                <li>✓ Venue type templates</li>
                <li>✓ Local dialect options</li>
              </ul>
            </div>

            
          </div>
          </Container>
        </section>

        {/* Pricing Preview Section */}
        <section>
          <Container className="py-16">
          <div className="my-12 rounded-2xl bg-gradient-to-r from-primary/5 to-primary/10 p-6 md:p-8">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold md:text-4xl">
            Simple, Transparent Pricing for UK Hospitality
          </h2>
          <p className="mb-12 text-center text-xl text-text-secondary">
            Start free. Upgrade when you're ready. Cancel anytime.
          </p>
          
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
            <div className="rounded-xl bg-white p-6 shadow-md">
              <h3 className="mb-2 text-xl font-semibold">Free Trial</h3>
              <div className="mb-4 text-3xl font-bold">
                £0 <span className="text-base font-normal text-text-secondary">for 14 days</span>
              </div>
              <ul className="mb-6 space-y-2 text-sm">
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />10 campaigns</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />All platforms</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />AI content generation</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />No credit card required</li>
              </ul>
              <Link href="/#waitlist" className="block rounded-lg bg-primary px-4 py-2 text-center text-white hover:bg-primary/90">
                Join Waitlist
              </Link>
            </div>
            
            <div className="relative rounded-xl border-2 border-primary bg-white p-6 shadow-lg">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs text-white">
                MOST POPULAR
              </span>
              <h3 className="mb-2 text-xl font-semibold">Starter</h3>
              <div className="mb-4 text-3xl font-bold">
                £29 <span className="text-base font-normal text-text-secondary">/month</span>
              </div>
              <ul className="mb-6 space-y-2 text-sm">
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />5 campaigns/month</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />50 posts/month</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />2 team members</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />Priority support</li>
              </ul>
              <Link href="/#waitlist" className="block rounded-lg bg-primary px-4 py-2 text-center text-white hover:bg-primary/90">
                Join Waitlist
              </Link>
            </div>
            
            <div className="rounded-xl bg-white p-6 shadow-md">
              <h3 className="mb-2 text-xl font-semibold">Professional</h3>
              <div className="mb-4 text-3xl font-bold">
                £44.99 <span className="text-base font-normal text-text-secondary">/month</span>
              </div>
              <ul className="mb-6 space-y-2 text-sm">
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />20 campaigns/month</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />200 posts/month</li>
                <li><CheckCircle className="mr-2 inline size-4 text-green-500" />5 team members</li>
                
              </ul>
              <Link href="/#waitlist" className="block rounded-lg bg-primary px-4 py-2 text-center text-white hover:bg-primary/90">
                Join Waitlist
              </Link>
            </div>
          </div>
          </div>
          </Container>
        </section>

        {/* FAQ Section */}
        <section>
          <Container className="py-16">
          <h2 className="mb-12 text-center font-heading text-3xl font-bold md:text-4xl">
            Frequently Asked Questions
          </h2>
          
          <div className="mx-auto max-w-3xl space-y-6">
            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                How much time can CheersAI save my pub or restaurant?
              </summary>
              <p className="mt-4 text-text-secondary">
                Venues typically save hours each week with CheersAI. Our AI drafts engaging posts in seconds, schedules them across platforms, and keeps your calendar full – freeing you to focus on guests.
              </p>
            </details>
            
            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                Which social media platforms does CheersAI support?
              </summary>
              <p className="mt-4 text-text-secondary">
                CheersAI supports the platforms where your customers are: Facebook, Instagram, and Google Business Profile. LinkedIn is coming soon. Post once and publish everywhere with platform‑optimised content.
              </p>
            </details>
            
            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                Is CheersAI suitable for small independent pubs?
              </summary>
              <p className="mt-4 text-text-secondary">
                Yes. CheersAI is designed for independent pubs, restaurants and bars. The Starter plan includes AI content creation and multi‑platform scheduling so smaller venues can compete with larger chains.
              </p>
            </details>
            
            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                Can CheersAI help promote pub quizzes and special events?
              </summary>
              <p className="mt-4 text-text-secondary">
                Yes! CheersAI excels at event promotion. Create entire campaigns for pub quizzes, live music nights, seasonal menus, or special offers. Our AI understands UK hospitality events and generates perfectly-timed posts to maximise attendance.
              </p>
            </details>
            
            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                Do I need technical skills to use CheersAI?
              </summary>
              <p className="mt-4 text-text-secondary">
                Not at all. CheersAI is built for busy hospitality professionals, not tech experts. If you can use Facebook, you can use CheersAI. Our simple interface and AI assistant handle all the complex work for you.
              </p>
            </details>

            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                Do I need a credit card for the free trial?
              </summary>
              <p className="mt-4 text-text-secondary">
                No. Start a 14‑day free trial without a credit card. You can upgrade any time from within the app.
              </p>
            </details>

            <details className="rounded-lg bg-white p-6 shadow-md">
              <summary className="cursor-pointer text-lg font-semibold">
                Will posts go live without my approval?
              </summary>
              <p className="mt-4 text-text-secondary">
                You are in control. Approve posts before publishing or enable scheduling for trusted campaigns.
              </p>
            </details>
          </div>
          </Container>
        </section>

        {/* Location/Service Area Section */}
        <section>
          <Container className="py-12">
          <div className="my-12 rounded-2xl bg-primary/5 p-6 md:p-8">
          <h2 className="mb-8 text-center font-heading text-2xl font-bold md:text-3xl">
            Serving Hospitality Businesses Across the UK
          </h2>
          <div className="mx-auto max-w-4xl text-center text-text-secondary">
            <p className="mb-6">
              From traditional pubs in London to gastropubs in the Cotswolds, trendy bars in Manchester to family restaurants in Edinburgh - CheersAI helps hospitality businesses throughout the United Kingdom maximise their social media impact.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Liverpool", "Bristol", "Leeds", "Newcastle", "Cardiff", "Belfast", "Nottingham", "Sheffield", "Southampton", "Leicester"].map(city => (
                <span key={city} className="rounded-full bg-white px-3 py-1 text-sm">
                  {city}
                </span>
              ))}
            </div>
          </div>
          </div>
        </Container>
        </section>

        {/* Final CTA Section */}
        <section>
          <Container className="py-16">
          <div className="rounded-2xl bg-gradient-to-r from-primary to-primary/80 p-12 text-center text-white">
            <h2 className="mb-4 font-heading text-3xl font-bold md:text-4xl">
              Ready to Fill Your Venue Every Night?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-xl opacity-95">
              Join UK pubs, restaurants and bars modernising their marketing with AI‑assisted social media.
            </p>
            
            <div className="mb-6 flex flex-col justify-center gap-4 sm:flex-row">
              <Link href="/#waitlist" className="rounded-lg bg-white px-8 py-4 font-semibold text-primary transition hover:bg-gray-100">
                Join the Waitlist
                <ArrowRight className="ml-2 inline size-5" />
              </Link>
            </div>
            
            <div className="flex flex-wrap justify-center gap-6 text-sm opacity-90">
              <span><CheckCircle className="mr-1 inline size-4" /> No credit card required</span>
              <span><CheckCircle className="mr-1 inline size-4" /> Set up in 2 minutes</span>
              <span><CheckCircle className="mr-1 inline size-4" /> Cancel anytime</span>
            </div>
          </div>
          </Container>
        </section>

        {/* Footer Links for SEO */}
        <footer className="border-t border-gray-200">
          <Container className="py-8">
          <div className="flex flex-wrap justify-center gap-6 text-sm text-text-secondary">
            <Link href="/privacy" className="hover:text-primary">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-primary">Terms of Service</Link>
            <Link href="/help" className="hover:text-primary">Help Centre</Link>
            <Link href="/auth/login" className="hover:text-primary">Sign In</Link>
            <Link href="/#waitlist" className="hover:text-primary">Join Waitlist</Link>
          </div>
          <p className="mt-4 text-center text-xs text-text-secondary">
            © 2024 CheersAI. Built with ❤️ for UK hospitality businesses.
          </p>
          </Container>
        </footer>
      </div>
    </>
  );
}
