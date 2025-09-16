import Link from "next/link";
import Container from "@/components/layout/container";
import { ChevronLeft } from "lucide-react";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-text-secondary hover:bg-muted rounded-md px-3 py-2">
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-heading font-bold">Privacy Policy</h1>
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-8 max-w-4xl">
        <div className="prose prose-gray max-w-none">
          <p className="text-sm text-text-secondary mb-6">
            Last updated: January 2, 2025 | Effective date: January 2, 2025
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">1. Introduction</h2>
            <p className="mb-4">
              CheersAI ("we," "our," or "us") is committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our social media management platform and services.
            </p>
            <p className="mb-4">
              This policy applies to all users of CheersAI, including pub and hospitality business owners, their staff members, and any authorised users of our platform. We comply with the UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018, and other applicable data protection laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">2. Information We Collect</h2>
            
            <h3 className="text-lg font-semibold mb-3">2.1 Information You Provide</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Account Information:</strong> Name, email address, phone number, business name, and password</li>
              <li><strong>Business Profile:</strong> Business type, location, tone preferences, target audience, and branding information</li>
              <li><strong>Payment Information:</strong> Processed securely through Stripe (we do not store card details)</li>
              <li><strong>Content:</strong> Campaign details, posts, images, and media you upload</li>
              <li><strong>Communications:</strong> Support requests, feedback, and correspondence with us</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">2.2 Information from Social Media Platforms</h3>
            <p className="mb-4">When you connect your social media accounts, we may collect:</p>
            <ul className="list-disc pl-6 mb-4">
              <li>Page/account names and IDs</li>
              <li>Page access tokens for publishing</li>
              <li>Basic profile information</li>
              <li>Engagement metrics and analytics</li>
              <li>Published post performance data</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">2.3 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Usage Data:</strong> Features used, campaigns created, posts generated</li>
              <li><strong>Device Information:</strong> IP address, browser type, operating system</li>
              <li><strong>Cookies:</strong> Session cookies for authentication and preferences</li>
              <li><strong>Analytics:</strong> Page views, feature usage, and performance metrics</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">3. Legal Basis for Processing</h2>
            <p className="mb-4">We process your personal data based on the following legal grounds:</p>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Contract Performance:</strong> To provide our services and fulfill our agreement with you</li>
              <li><strong>Legitimate Interests:</strong> To improve our services, ensure security, and prevent fraud</li>
              <li><strong>Legal Obligations:</strong> To comply with applicable laws and regulations</li>
              <li><strong>Consent:</strong> For marketing communications and certain data processing activities</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">4. How We Use Your Information</h2>
            <ul className="list-disc pl-6 mb-4">
              <li>Provide, maintain, and improve our services</li>
              <li>Generate AI-powered content based on your preferences</li>
              <li>Publish content to your connected social media accounts</li>
              <li>Process payments and manage subscriptions</li>
              <li>Send service updates, security alerts, and support messages</li>
              <li>Analyse usage patterns to enhance user experience</li>
              <li>Comply with legal obligations and enforce our terms</li>
              <li>Prevent fraud, abuse, and unauthorised access</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">5. Data Sharing and Disclosure</h2>
            <p className="mb-4">We do not sell your personal data. We may share your information with:</p>
            
            <h3 className="text-lg font-semibold mb-3">5.1 Service Providers</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Supabase:</strong> Database hosting and authentication (data stored in UK/EU regions)</li>
              <li><strong>OpenAI:</strong> AI content generation (30-day retention, no training on your data)</li>
              <li><strong>Stripe:</strong> Payment processing (PCI DSS compliant)</li>
              <li><strong>Vercel:</strong> Application hosting and analytics</li>
              <li><strong>Resend:</strong> Transactional email delivery</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">5.2 Social Media Platforms</h3>
            <p className="mb-4">
              When you connect accounts and publish content, data is shared with Facebook, Instagram, and other platforms according to their respective privacy policies.
            </p>

            <h3 className="text-lg font-semibold mb-3">5.3 Legal Requirements</h3>
            <p className="mb-4">
              We may disclose information if required by law, court order, or governmental authority, or to protect our rights and safety.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">6. Data Retention</h2>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Account Data:</strong> Retained while your account is active and for 30 days after deletion</li>
              <li><strong>Content:</strong> Campaign posts retained for 90 days after publishing</li>
              <li><strong>AI Prompts:</strong> OpenAI retains for 30 days for abuse monitoring (not used for training)</li>
              <li><strong>Payment Records:</strong> Retained as required for tax and accounting purposes (typically 7 years)</li>
              <li><strong>Analytics:</strong> Aggregated data retained for service improvement</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">7. Data Security</h2>
            <p className="mb-4">We implement industry-standard security measures including:</p>
            <ul className="list-disc pl-6 mb-4">
              <li>AES-256 encryption for data at rest</li>
              <li>TLS 1.2+ encryption for data in transit</li>
              <li>Row-level security in our database</li>
              <li>Regular security audits and updates</li>
              <li>Multi-factor authentication support</li>
              <li>Secure API key management</li>
              <li>PCI DSS compliant payment processing</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">8. Your Rights</h2>
            <p className="mb-4">Under UK GDPR, you have the following rights:</p>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Rectification:</strong> Correct inaccurate or incomplete data</li>
              <li><strong>Erasure:</strong> Request deletion of your data ("right to be forgotten")</li>
              <li><strong>Portability:</strong> Receive your data in a portable format</li>
              <li><strong>Restriction:</strong> Limit processing of your data</li>
              <li><strong>Objection:</strong> Object to certain processing activities</li>
              <li><strong>Automated Decision-Making:</strong> Not be subject to solely automated decisions</li>
            </ul>
            <p className="mb-4">
              To exercise these rights, contact us at privacy@orangejelly.co.uk. We will respond within 30 days.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">9. Cookies and Tracking</h2>
            <p className="mb-4">We use essential cookies for:</p>
            <ul className="list-disc pl-6 mb-4">
              <li>Authentication and session management</li>
              <li>Security and fraud prevention</li>
              <li>User preferences and settings</li>
            </ul>
            <p className="mb-4">
              We do not use third-party advertising cookies or trackers. You can manage cookies through your browser settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">10. Children's Privacy</h2>
            <p className="mb-4">
              Our services are not directed to individuals under 18. We do not knowingly collect personal information from children. If we become aware of such collection, we will delete the information immediately.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">11. International Data Transfers</h2>
            <p className="mb-4">
              Your data may be processed in the UK, EU, and US. We ensure appropriate safeguards through:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Standard contractual clauses with service providers</li>
              <li>Data processing agreements with all third parties</li>
              <li>Selection of privacy-focused service providers</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">12. Changes to This Policy</h2>
            <p className="mb-4">
              We may update this Privacy Policy periodically. We will notify you of material changes via email or platform notification. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">13. Contact Information</h2>
            <div className="bg-gray-50 p-4 rounded-medium">
              <p className="mb-2"><strong>Data Controller:</strong> CheersAI (<a href="https://www.orangejelly.co.uk" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">Orange Jelly Limited</a>)</p>
              <p className="mb-2"><strong>Email:</strong> privacy@orangejelly.co.uk</p>
              <p className="mb-2"><strong>Address:</strong> <a href="https://www.orangejelly.co.uk" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">Orange Jelly Limited</a>, United Kingdom</p>
              <p className="mb-4"><strong>Data Protection Officer:</strong> dpo@cheersai.com</p>
              
              <p className="mb-2"><strong>Supervisory Authority:</strong></p>
              <p className="mb-2">Information Commissioner's Office (ICO)</p>
              <p className="mb-2">Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF</p>
              <p>Website: ico.org.uk</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">14. Facebook and Instagram Data</h2>
            <p className="mb-4">
              When using our Facebook and Instagram integration:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>We only access data necessary for content publishing</li>
              <li>We do not store Facebook passwords</li>
              <li>Page tokens are encrypted and stored securely</li>
              <li>We comply with Meta's Platform Terms and Developer Policies</li>
              <li>You can revoke access at any time through Facebook Settings</li>
            </ul>
          </section>
        </div>
        </Container>
      </main>
    </div>
  );
}
