import Link from "next/link";
import { Calendar, Megaphone, Sparkles, Clock, TrendingUp, Users, Zap, CheckCircle, ArrowRight, MessageSquare, BarChart, Shield, Pound } from "lucide-react";
import BrandLogo from "@/components/ui/BrandLogo";
import Container from "@/components/layout/container";
import type { Metadata } from "next";

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
  twitter: {
    card: "summary_large_image",
    title: "CheersAI - AI Social Media for UK Pubs & Restaurants",
    description: "Automate your hospitality marketing. AI creates engaging posts that fill tables. Built for UK pubs, restaurants & bars. Free trial.",
    images: ["/logo.png"],
  },
  alternates: {
    canonical: "https://cheersai.orangejelly.co.uk",
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
      "url": "https://cheersai.orangejelly.co.uk",
      "author": {
        "@type": "Organization",
        "name": "CheersAI",
        "url": "https://cheersai.orangejelly.co.uk"
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
        "Multi-platform scheduling (Facebook, Instagram, Twitter)",
        "Brand voice customisation",
        "Event campaign automation",
        "Pub quiz and special offers promotion",
        "Team collaboration tools",
        "UK-specific templates and content ideas"
      ],
      "screenshot": "https://cheersai.orangejelly.co.uk/logo.png",
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
      "url": "https://cheersai.orangejelly.co.uk",
      "logo": "https://cheersai.orangejelly.co.uk/logo.png",
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
            "text": "CheersAI supports the platforms where your customers are: Facebook, Instagram, and Twitter/X. Google Business Profile is available, and LinkedIn is coming soon. Post once and publish everywhere with platform‑optimised content."
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
        {/* Hero Section with Trust Signals */}
        <section>
          <Container className="py-12 md:py-20">
          <div className="text-center mb-16">
            <div className="flex justify-center mb-8">
              <BrandLogo variant="full" />
            </div>
            
            {/* Trust signals (no inflated claims) */}
            <div className="flex flex-wrap justify-center gap-3 md:gap-4 mb-8">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary/10 text-primary">
                <Shield className="w-4 h-4 mr-1" /> Built for UK hospitality
              </span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary/10 text-primary">
                <Sparkles className="w-4 h-4 mr-1" /> British English & UK templates
              </span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary/10 text-primary">
                <Clock className="w-4 h-4 mr-1" /> Save hours every week
              </span>
            </div>

            <h1 className="text-4xl md:text-6xl font-heading font-bold mb-6 text-text-primary">
              AI Social Media Management for <br className="hidden md:block" />
              <span className="text-primary">UK Pubs, Restaurants & Bars</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-text-secondary max-w-3xl mx-auto mb-8">
              Spend less time on socials and more time serving guests. CheersAI creates on‑brand posts, plans your calendar, and publishes at the right time.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
              <Link href="/auth/signup" className="bg-primary text-white rounded-md text-lg px-8 py-4 inline-flex items-center justify-center">
                Start 14-Day Free Trial
                <ArrowRight className="inline ml-2 w-5 h-5" />
              </Link>
              <Link href="/auth/login" className="border border-input rounded-md text-lg px-8 py-4 inline-flex items-center justify-center">
                Sign In
              </Link>
            </div>
            
            <p className="text-sm text-text-secondary">
              ✓ No credit card required &nbsp; ✓ Set up in 2 minutes &nbsp; ✓ Cancel anytime
            </p>
          </div>
          </Container>
        </section>

        {/* Problem/Solution Section */}
        <section>
          <Container className="py-12">
          <div className="max-w-4xl mx-auto bg-white/50 rounded-2xl p-6 md:p-8 mb-12">
            <h2 className="text-3xl md:text-4xl font-heading font-bold text-center mb-12">
              Social Media Shouldn’t Take Hours Every Day
            </h2>
            
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-semibold mb-4 text-red-600">❌ Without CheersAI</h3>
                <ul className="space-y-3 text-text-secondary">
                  <li>• Spend 2+ hours daily creating posts</li>
                  <li>• Struggle with what to post</li>
                  <li>• Miss peak engagement times</li>
                  <li>• Inconsistent posting schedule</li>
                  <li>• Generic content that doesn't convert</li>
                </ul>
              </div>
              
              <div>
                <h3 className="text-xl font-semibold mb-4 text-green-600">✅ With CheersAI</h3>
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
          <h2 className="text-3xl md:text-4xl font-heading font-bold text-center mb-4">
            Everything You Need to Market Your Hospitality Business
          </h2>
          <p className="text-xl text-center text-text-secondary mb-12 max-w-3xl mx-auto">
            Purpose-built features for UK pubs, restaurants, bars, and cafes
          </p>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-lg transition-shadow">
              <div className="flex justify-center mb-4">
                <Calendar className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-heading font-semibold mb-3">Event Campaign Automation</h3>
              <p className="text-text-secondary mb-4">
                Pub quiz? Live music? Sunday roast? Create complete campaigns with countdown posts, reminders, and follow-ups. All scheduled automatically.
              </p>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>✓ Quiz night templates</li>
                <li>✓ Special offer campaigns</li>
                <li>✓ Seasonal menu launches</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-lg transition-shadow">
              <div className="flex justify-center mb-4">
                <Sparkles className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-heading font-semibold mb-3">UK Hospitality AI Writer</h3>
              <p className="text-text-secondary mb-4">
                Our AI understands British pubs and restaurants. Generate posts about bank holidays, match days, and local events that resonate with your community.
              </p>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>✓ British spelling & terminology</li>
                <li>✓ Local area knowledge</li>
                <li>✓ Venue personality matching</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-lg transition-shadow">
              <div className="flex justify-center mb-4">
                <Megaphone className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-heading font-semibold mb-3">Multi-Platform Publishing</h3>
              <p className="text-text-secondary mb-4">
                Post to Facebook, Instagram & Twitter from one dashboard. Each platform gets optimised content - hashtags, emojis, and formatting. LinkedIn is coming soon.
              </p>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>✓ Platform‑specific optimisation</li>
                <li>✓ Best time scheduling</li>
                <li>✓ Google Business Profile (coming soon)</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-lg transition-shadow">
              <div className="flex justify-center mb-4">
                <Clock className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-heading font-semibold mb-3">Smart Scheduling</h3>
              <p className="text-text-secondary mb-4">
                Set your posting schedule once. CheersAI publishes when your customers are most active - lunch rushes, after work, weekend planning times.
              </p>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>✓ Peak time auto-posting</li>
                <li>✓ Timezone-aware for UK</li>
                <li>✓ Holiday adjustments</li>
              </ul>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-lg transition-shadow">
              <div className="flex justify-center mb-4">
                <MessageSquare className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-heading font-semibold mb-3">Brand Voice Training</h3>
              <p className="text-text-secondary mb-4">
                Gastropub? Sports bar? Fine dining? Train the AI on your unique style. Every post sounds authentically you, not generic marketing speak.
              </p>
              <ul className="text-sm text-text-secondary space-y-1">
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
          <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-2xl my-12 p-6 md:p-8">
          <h2 className="text-3xl md:text-4xl font-heading font-bold text-center mb-4">
            Simple, Transparent Pricing for UK Hospitality
          </h2>
          <p className="text-xl text-center text-text-secondary mb-12">
            Start free. Upgrade when you're ready. Cancel anytime.
          </p>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-xl font-semibold mb-2">Free Trial</h3>
              <div className="text-3xl font-bold mb-4">
                £0 <span className="text-base font-normal text-text-secondary">for 14 days</span>
              </div>
              <ul className="space-y-2 mb-6 text-sm">
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />10 campaigns</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />All platforms</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />AI content generation</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />No credit card required</li>
              </ul>
              <Link href="/auth/signup" className="block text-center py-2 px-4 bg-primary text-white rounded-lg hover:bg-primary/90">
                Start Free Trial
              </Link>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-lg border-2 border-primary relative">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white px-3 py-1 rounded-full text-xs">
                MOST POPULAR
              </span>
              <h3 className="text-xl font-semibold mb-2">Starter</h3>
              <div className="text-3xl font-bold mb-4">
                £29 <span className="text-base font-normal text-text-secondary">/month</span>
              </div>
              <ul className="space-y-2 mb-6 text-sm">
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />5 campaigns/month</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />50 posts/month</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />2 team members</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />Priority support</li>
              </ul>
              <Link href="/auth/signup" className="block text-center py-2 px-4 bg-primary text-white rounded-lg hover:bg-primary/90">
                Start Free Trial
              </Link>
            </div>
            
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-xl font-semibold mb-2">Professional</h3>
              <div className="text-3xl font-bold mb-4">
                £44.99 <span className="text-base font-normal text-text-secondary">/month</span>
              </div>
              <ul className="space-y-2 mb-6 text-sm">
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />20 campaigns/month</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />200 posts/month</li>
                <li><CheckCircle className="inline w-4 h-4 text-green-500 mr-2" />5 team members</li>
                
              </ul>
              <Link href="/auth/signup" className="block text-center py-2 px-4 bg-primary text-white rounded-lg hover:bg-primary/90">
                Start Free Trial
              </Link>
            </div>
          </div>
          </div>
          </Container>
        </section>

        {/* FAQ Section */}
        <section>
          <Container className="py-16">
          <h2 className="text-3xl md:text-4xl font-heading font-bold text-center mb-12">
            Frequently Asked Questions
          </h2>
          
          <div className="max-w-3xl mx-auto space-y-6">
            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
                How much time can CheersAI save my pub or restaurant?
              </summary>
              <p className="mt-4 text-text-secondary">
                Venues typically save hours each week with CheersAI. Our AI drafts engaging posts in seconds, schedules them across platforms, and keeps your calendar full – freeing you to focus on guests.
              </p>
            </details>
            
            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
                Which social media platforms does CheersAI support?
              </summary>
              <p className="mt-4 text-text-secondary">
                CheersAI supports the platforms where your customers are: Facebook, Instagram, and Twitter/X. Google Business Profile is available, and LinkedIn is coming soon. Post once and publish everywhere with platform‑optimised content.
              </p>
            </details>
            
            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
                Is CheersAI suitable for small independent pubs?
              </summary>
              <p className="mt-4 text-text-secondary">
                Yes. CheersAI is designed for independent pubs, restaurants and bars. The Starter plan includes AI content creation and multi‑platform scheduling so smaller venues can compete with larger chains.
              </p>
            </details>
            
            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
                Can CheersAI help promote pub quizzes and special events?
              </summary>
              <p className="mt-4 text-text-secondary">
                Yes! CheersAI excels at event promotion. Create entire campaigns for pub quizzes, live music nights, seasonal menus, or special offers. Our AI understands UK hospitality events and generates perfectly-timed posts to maximise attendance.
              </p>
            </details>
            
            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
                Do I need technical skills to use CheersAI?
              </summary>
              <p className="mt-4 text-text-secondary">
                Not at all. CheersAI is built for busy hospitality professionals, not tech experts. If you can use Facebook, you can use CheersAI. Our simple interface and AI assistant handle all the complex work for you.
              </p>
            </details>

            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
                Do I need a credit card for the free trial?
              </summary>
              <p className="mt-4 text-text-secondary">
                No. Start a 14‑day free trial without a credit card. You can upgrade any time from within the app.
              </p>
            </details>

            <details className="bg-white rounded-lg p-6 shadow-md">
              <summary className="font-semibold text-lg cursor-pointer">
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
          <div className="bg-primary/5 rounded-2xl p-6 md:p-8 my-12">
          <h2 className="text-2xl md:text-3xl font-heading font-bold text-center mb-8">
            Serving Hospitality Businesses Across the UK
          </h2>
          <div className="text-center text-text-secondary max-w-4xl mx-auto">
            <p className="mb-6">
              From traditional pubs in London to gastropubs in the Cotswolds, trendy bars in Manchester to family restaurants in Edinburgh - CheersAI helps hospitality businesses throughout the United Kingdom maximise their social media impact.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Liverpool", "Bristol", "Leeds", "Newcastle", "Cardiff", "Belfast", "Nottingham", "Sheffield", "Southampton", "Leicester"].map(city => (
                <span key={city} className="px-3 py-1 bg-white rounded-full text-sm">
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
          <div className="text-center bg-gradient-to-r from-primary to-primary/80 text-white rounded-2xl p-12">
            <h2 className="text-3xl md:text-4xl font-heading font-bold mb-4">
              Ready to Fill Your Venue Every Night?
            </h2>
            <p className="text-xl mb-8 opacity-95 max-w-2xl mx-auto">
              Join UK pubs, restaurants and bars modernising their marketing with AI‑assisted social media.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
              <Link href="/auth/signup" className="bg-white text-primary px-8 py-4 rounded-lg font-semibold hover:bg-gray-100 transition">
                Start Your 14-Day Free Trial
                <ArrowRight className="inline ml-2 w-5 h-5" />
              </Link>
            </div>
            
            <div className="flex flex-wrap justify-center gap-6 text-sm opacity-90">
              <span><CheckCircle className="inline w-4 h-4 mr-1" /> No credit card required</span>
              <span><CheckCircle className="inline w-4 h-4 mr-1" /> Set up in 2 minutes</span>
              <span><CheckCircle className="inline w-4 h-4 mr-1" /> Cancel anytime</span>
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
            <Link href="/auth/signup" className="hover:text-primary">Get Started Free</Link>
          </div>
          <p className="text-center mt-4 text-xs text-text-secondary">
            © 2024 CheersAI. Built with ❤️ for UK hospitality businesses.
          </p>
          </Container>
        </footer>
      </div>
    </>
  );
}
