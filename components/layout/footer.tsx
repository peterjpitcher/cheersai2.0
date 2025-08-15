import Link from "next/link";
import Logo from "@/components/ui/logo";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-surface border-t border-border mt-auto">
      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <Logo variant="compact" className="h-10 mb-4" />
            <p className="text-sm text-text-secondary mb-3">
              AI-powered social media management designed specifically for UK pubs, bars, and restaurants.
            </p>
            <p className="text-xs text-text-secondary/70">
              Part of the <span className="font-semibold text-primary">Orange Jelly Family</span> of tools 
              that help hospitality businesses accelerate their growth through AI.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold mb-4">Product</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/features" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/demo" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Book a Demo
                </Link>
              </li>
              <li>
                <Link href="/roadmap" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Roadmap
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="font-semibold mb-4">Support</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/help" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Help Center
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Contact Us
                </Link>
              </li>
              <li>
                <Link href="/status" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  System Status
                </Link>
              </li>
              <li>
                <a href="mailto:support@cheersai.com" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  support@cheersai.com
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold mb-4">Legal</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/privacy" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  Cookie Policy
                </Link>
              </li>
              <li>
                <Link href="/gdpr" className="text-sm text-text-secondary hover:text-primary transition-colors">
                  GDPR
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-8 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-text-secondary">
            © {currentYear} CheersAI Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a 
              href="https://twitter.com/cheersai" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-text-secondary hover:text-primary transition-colors"
            >
              Twitter
            </a>
            <a 
              href="https://linkedin.com/company/cheersai" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-text-secondary hover:text-primary transition-colors"
            >
              LinkedIn
            </a>
            <a 
              href="https://facebook.com/cheersai" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-text-secondary hover:text-primary transition-colors"
            >
              Facebook
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}