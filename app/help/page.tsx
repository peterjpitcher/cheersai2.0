import Link from "next/link";
import { ChevronLeft, Mail, MessageCircle, Phone, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function HelpPage() {
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
              <h1 className="text-2xl font-heading font-bold">Help & Support</h1>
              <p className="text-sm text-text-secondary">
                Get in touch with our support team
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-heading font-bold mb-4">
            Need Help?
          </h2>
          <p className="text-lg text-text-secondary">
            We're here to help you get the most out of CheersAI
          </p>
        </div>

        {/* Contact Methods */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Email Support */}
          <Card className="p-6 text-center">
            <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Email Support</h3>
            <p className="text-text-secondary mb-4">
              Best for general inquiries and detailed questions
            </p>
            <a 
              href="mailto:peter@orangejelly.co.uk" 
              className="text-primary font-medium hover:underline"
            >
              peter@orangejelly.co.uk
            </a>
            <p className="text-sm text-text-secondary mt-2">
              Response within 24 hours
            </p>
          </Card>

          {/* WhatsApp Support */}
          <Card className="p-6 text-center">
            <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg mb-2">WhatsApp</h3>
            <p className="text-text-secondary mb-4">
              Quick questions and urgent support
            </p>
            <a 
              href="https://wa.me/447990587315" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 font-medium hover:underline"
            >
              07990 587315
            </a>
            <p className="text-sm text-text-secondary mt-2">
              Available Mon-Fri, 9am-6pm
            </p>
          </Card>

          {/* Phone Support */}
          <Card className="p-6 text-center">
            <div className="bg-purple-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Phone className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Phone (Emergencies)</h3>
            <p className="text-text-secondary mb-4">
              For urgent issues affecting your business
            </p>
            <a 
              href="tel:+447990587315" 
              className="text-purple-600 font-medium hover:underline"
            >
              07990 587315
            </a>
            <p className="text-sm text-text-secondary mt-2">
              Emergency support only
            </p>
          </Card>
        </div>

        {/* Support Hours */}
        <Card className="bg-primary/5 border-primary/20 mb-12 p-6">
          <div className="flex items-start gap-4">
            <Clock className="w-6 h-6 text-primary mt-1" />
            <div>
              <h3 className="font-semibold text-lg mb-2">Support Hours</h3>
              <p className="text-text-secondary mb-3">
                Our support team is available during UK business hours:
              </p>
              <ul className="space-y-1 text-text-secondary">
                <li><strong className="text-text-primary">Monday - Friday:</strong> 9:00 AM - 6:00 PM GMT</li>
                <li><strong className="text-text-primary">Saturday:</strong> 10:00 AM - 2:00 PM GMT</li>
                <li><strong className="text-text-primary">Sunday:</strong> Closed (Emergency support only)</li>
              </ul>
              <p className="text-sm text-text-secondary mt-3">
                For emergencies outside these hours, please call or WhatsApp and we'll respond as soon as possible.
              </p>
            </div>
          </div>
        </Card>

        {/* Common Issues */}
        <Card className="p-6">
          <h3 className="font-semibold text-lg mb-4">Before You Contact Us</h3>
          <p className="text-text-secondary mb-4">
            Here are quick solutions to common issues:
          </p>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <div>
                <strong className="text-text-primary">Can't connect social accounts?</strong>
                <p className="text-sm text-text-secondary">
                  Make sure you're logged into the correct business account and have admin permissions.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <div>
                <strong className="text-text-primary">Posts not publishing?</strong>
                <p className="text-sm text-text-secondary">
                  Check your social connections in Settings → Connections and reconnect if needed.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <div>
                <strong className="text-text-primary">AI content not generating?</strong>
                <p className="text-sm text-text-secondary">
                  Ensure you've completed your brand profile in Settings and have campaign credits available.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
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
        <div className="text-center mt-12 p-6 bg-gradient-to-r from-primary/10 to-purple/10 rounded-large">
          <h3 className="font-semibold text-lg mb-2">Priority Support Available</h3>
          <p className="text-text-secondary mb-4">
            Professional and Enterprise plans include priority support with faster response times.
          </p>
          <Link href="/settings/billing">
            <Button>View Plans</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
