import Link from "next/link";
import { ChevronLeft, Mail, MessageCircle, Phone, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/container";

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-text-secondary hover:text-primary">
              <ChevronLeft className="size-6" />
            </Link>
            <div>
              <h1 className="font-heading text-2xl font-bold">Help & Support</h1>
              <p className="text-sm text-text-secondary">
                Get in touch with our support team
              </p>
            </div>
          </div>
        </Container>
      </header>

      <main>
        <Container className="max-w-4xl py-8">
        {/* Hero Section */}
        <div className="mb-12 text-center">
          <h2 className="mb-4 font-heading text-3xl font-bold">
            Need Help?
          </h2>
          <p className="text-lg text-text-secondary">
            We're here to help you get the most out of CheersAI
          </p>
        </div>

        {/* Contact Methods */}
        <div className="mb-12 grid gap-6 md:grid-cols-3">
          {/* Email Support */}
          <Card className="p-6 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
              <Mail className="size-8 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Email Support</h3>
            <p className="mb-4 text-text-secondary">
              Best for general inquiries and detailed questions
            </p>
            <a 
              href="mailto:peter@orangejelly.co.uk" 
              className="font-medium text-primary hover:underline"
            >
              peter@orangejelly.co.uk
            </a>
            <p className="mt-2 text-sm text-text-secondary">
              Response within 24 hours
            </p>
          </Card>

          {/* WhatsApp Support */}
          <Card className="p-6 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100">
              <MessageCircle className="size-8 text-green-600" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">WhatsApp</h3>
            <p className="mb-4 text-text-secondary">
              Quick questions and urgent support
            </p>
            <a 
              href="https://wa.me/447990587315" 
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-green-600 hover:underline"
            >
              07990 587315
            </a>
            <p className="mt-2 text-sm text-text-secondary">
              Available Mon-Fri, 9am-6pm
            </p>
          </Card>

          {/* Phone Support */}
          <Card className="p-6 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-purple-100">
              <Phone className="size-8 text-purple-600" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Phone (Emergencies)</h3>
            <p className="mb-4 text-text-secondary">
              For urgent issues affecting your business
            </p>
            <a 
              href="tel:+447990587315" 
              className="font-medium text-purple-600 hover:underline"
            >
              07990 587315
            </a>
            <p className="mt-2 text-sm text-text-secondary">
              Emergency support only
            </p>
          </Card>
        </div>

        {/* Support Hours */}
        <Card className="mb-12 border-primary/20 bg-primary/5 p-6">
          <div className="flex items-start gap-4">
            <Clock className="mt-1 size-6 text-primary" />
            <div>
              <h3 className="mb-2 text-lg font-semibold">Support Hours</h3>
              <p className="mb-3 text-text-secondary">
                Our support team is available during UK business hours:
              </p>
              <ul className="space-y-1 text-text-secondary">
                <li><strong className="text-text-primary">Monday - Friday:</strong> 9:00 AM - 6:00 PM GMT</li>
                <li><strong className="text-text-primary">Saturday:</strong> 10:00 AM - 2:00 PM GMT</li>
                <li><strong className="text-text-primary">Sunday:</strong> Closed (Emergency support only)</li>
              </ul>
              <p className="mt-3 text-sm text-text-secondary">
                For emergencies outside these hours, please call or WhatsApp and we'll respond as soon as possible.
              </p>
            </div>
          </div>
        </Card>

        {/* Common Issues */}
        <Card className="p-6">
          <h3 className="mb-4 text-lg font-semibold">Before You Contact Us</h3>
          <p className="mb-4 text-text-secondary">
            Here are quick solutions to common issues:
          </p>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <span className="mt-1 text-primary">•</span>
              <div>
                <strong className="text-text-primary">Can't connect social accounts?</strong>
                <p className="text-sm text-text-secondary">
                  Make sure you're logged into the correct business account and have admin permissions.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 text-primary">•</span>
              <div>
                <strong className="text-text-primary">Posts not publishing?</strong>
                <p className="text-sm text-text-secondary">
                  Check your social connections in Settings → Connections and reconnect if needed.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 text-primary">•</span>
              <div>
                <strong className="text-text-primary">AI content not generating?</strong>
                <p className="text-sm text-text-secondary">
                  Ensure you've completed your brand profile in Settings and have campaign credits available.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 text-primary">•</span>
              <div>
                <strong className="text-text-primary">Billing questions?</strong>
                <p className="text-sm text-text-secondary">
                  Visit Settings → Billing to manage your subscription and payment methods.
                </p>
              </div>
            </li>
          </ul>
        </Card>

        {/* Priority Support Notice */}
        <div className="mt-12 rounded-large bg-gradient-to-r from-primary/10 to-purple-100/10 p-6 text-center">
          <h3 className="mb-2 text-lg font-semibold">Priority Support Available</h3>
          <p className="mb-4 text-text-secondary">
            Professional and Enterprise plans include priority support with faster response times.
          </p>
          <Link href="/settings/billing">
            <Button>View Plans</Button>
          </Link>
        </div>
        </Container>
      </main>
    </div>
  );
}
