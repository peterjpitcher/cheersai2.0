import Link from 'next/link'
import Container from '@/components/layout/container'
import { Check, Calendar, Megaphone, Layers, Users, Sparkles, Share2, Shield } from 'lucide-react'

export default function FeaturesPage() {
  return (
    <div className="bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
        <Container className="flex items-center justify-between py-4">
          <Link href="/" className="font-heading text-lg font-bold">CheersAI</Link>
          <nav className="hidden gap-6 text-sm sm:flex" aria-label="Primary">
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

      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/5 to-transparent">
        <Container className="py-12 md:py-16">
          <div className="max-w-3xl">
            <h1 className="mb-4 font-heading text-3xl font-bold md:text-5xl">
              Everything you need to run hospitality social media
            </h1>
            <p className="mb-6 max-w-2xl text-lg text-text-secondary">
              Built for UK pubs, restaurants and bars. Create AI-powered campaigns, schedule posts across platforms, and keep your calendar full – without spending hours each day.
            </p>
            <div className="flex gap-3">
              <Link href="/#waitlist" className="rounded-md bg-primary px-5 py-3 text-white">Join the waitlist</Link>
              <Link href="/pricing" className="rounded-md border border-input px-5 py-3">See pricing</Link>
            </div>
          </div>
        </Container>
      </section>

      {/* Features grid */}
      <section>
        <Container className="grid gap-6 py-12 md:grid-cols-2">
          <FeatureCard
            icon={<Sparkles className="size-6" />}
            title="AI content generation"
            points={[
              'Generate on-brand post ideas and captions',
              'Platform-aware prompts for Facebook, Instagram, and Google Business Profile',
              'Quick Post for one-off updates',
            ]}
          />
          <FeatureCard
            icon={<Megaphone className="size-6" />}
            title="Campaigns"
            points={[
              'Plan campaigns for events and promotions',
              'Auto-generate multiple posts per campaign',
              'Track status across campaigns',
            ]}
          />
          <FeatureCard
            icon={<Calendar className="size-6" />}
            title="Calendar & queue"
            points={[
              'Weekly queue and calendar views',
              'Posting schedules per platform',
              'Draft, approve, and schedule content',
            ]}
          />
          <FeatureCard
            icon={<Share2 className="size-6" />}
            title="Multi‑platform publishing"
              points={[
              'Connect Facebook, Instagram, and Google Business Profile',
              'Publish images and text with platform-specific constraints',
              'OAuth-based connections managed in Settings',
            ]}
          />
          <FeatureCard
            icon={<Layers className="size-6" />}
            title="Media library"
            points={[
              'Upload and reuse images across campaigns',
              'Attach media to posts before publishing',
              'Unlimited storage on paid plans',
            ]}
          />
          <FeatureCard
            icon={<Users className="size-6" />}
            title="Team access"
            points={[
              'Invite teammates with roles',
              'Starter includes 2 seats, Professional includes 5',
              'Manage team in Settings → Team',
            ]}
          />
        </Container>
      </section>

      {/* Trust / reliability */}
      <section className="border-y border-border bg-surface">
        <Container className="grid gap-6 py-10 md:grid-cols-3">
          <TrustItem title="Reliable publishing" desc="Built-in retries and circuit-breakers for social APIs to keep publishing resilient." icon={<Shield className="size-6 text-primary" />} />
          <TrustItem title="Secure by design" desc="Supabase authentication, RLS, and GDPR export/delete endpoints for user data." icon={<Shield className="size-6 text-primary" />} />
          <TrustItem title="UK-focused" desc="British English defaults, UK date/time formats, and hospitality-first workflows." icon={<Shield className="size-6 text-primary" />} />
        </Container>
      </section>

      {/* CTA */}
      <section>
        <Container className="py-12 text-center">
          <h2 className="mb-3 font-heading text-2xl font-bold md:text-3xl">Signups are currently closed</h2>
          <p className="mb-6 text-text-secondary">Leave your email and we’ll notify you as soon as it’s ready.</p>
          <Link href="/#waitlist" className="inline-block rounded-md bg-primary px-6 py-3 text-white">Join the waitlist</Link>
        </Container>
      </section>
    </div>
  )
}

function FeatureCard({ icon, title, points }: { icon: React.ReactNode; title: string; points: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
        <h3 className="font-heading text-lg font-bold">{title}</h3>
      </div>
      <ul className="space-y-2 text-sm text-text-secondary">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 text-primary" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TrustItem({ title, desc, icon }: { title: string; desc: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {icon}
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="text-sm text-text-secondary">{desc}</p>
      </div>
    </div>
  )
}
