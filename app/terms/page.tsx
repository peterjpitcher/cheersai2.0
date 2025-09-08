import Link from "next/link";
import Container from "@/components/layout/container";
import { ChevronLeft } from "lucide-react";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-text-secondary hover:bg-muted rounded-md px-3 py-2">
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-heading font-bold">Terms of Service</h1>
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
            <h2 className="text-xl font-heading font-bold mb-4">1. Acceptance of Terms</h2>
            <p className="mb-4">
              By accessing or using CheersAI ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of these terms, you may not access the Service.
            </p>
            <p className="mb-4">
              These Terms apply to all visitors, users, and others who access or use the Service, including pub and hospitality business owners, their employees, and authorised team members.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">2. Description of Service</h2>
            <p className="mb-4">
              CheersAI is a social media management platform that provides:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>AI-powered content generation for social media posts</li>
              <li>Campaign creation and management tools</li>
              <li>Social media account integration and publishing</li>
              <li>Media library and asset management</li>
              <li>Team collaboration features</li>
            </ul>
            <p className="mb-4">
              The Service is designed specifically for hospitality businesses to streamline their social media marketing efforts.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">3. Account Registration</h2>
            
            <h3 className="text-lg font-semibold mb-3">3.1 Account Creation</h3>
            <p className="mb-4">
              To use certain features of the Service, you must register for an account. You agree to:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Provide accurate, current, and complete information</li>
              <li>Maintain and update your information to keep it accurate</li>
              <li>Maintain the security of your password and account</li>
              <li>Accept responsibility for all activities under your account</li>
              <li>Notify us immediately of any unauthorised use</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">3.2 Account Requirements</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>You must be at least 18 years old</li>
              <li>You must have the legal authority to enter into these Terms</li>
              <li>You must not have been previously banned from the Service</li>
              <li>You must comply with all applicable laws and regulations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">4. Subscriptions and Billing</h2>
            
            <h3 className="text-lg font-semibold mb-3">4.1 Free Trial</h3>
            <p className="mb-4">
              New users receive a 14-day free trial with the following limitations:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Maximum 5 campaigns</li>
              <li>10 AI-generated posts</li>
              <li>10 media uploads</li>
              <li>1 social account connection</li>
              <li>No scheduling (immediate publish only)</li>
              <li>No team members</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">4.2 Subscription Plans</h3>
            <div className="bg-gray-50 p-4 rounded-medium mb-4">
              <p className="mb-2"><strong>Starter (£19.99/month or £215/year):</strong></p>
              <ul className="list-disc pl-6 mb-2">
                <li>10 campaigns per month</li>
                <li>50 AI-generated posts</li>
                <li>100 media uploads</li>
                <li>3 social accounts</li>
                <li>2 team members</li>
              </ul>

              <p className="mb-2 mt-4"><strong>Professional (£44.99/month or £485/year):</strong></p>
              <ul className="list-disc pl-6 mb-2">
                <li>Unlimited campaigns</li>
                <li>200 AI-generated posts</li>
                <li>500 media uploads</li>
                <li>10 social accounts</li>
                <li>5 team members</li>
              </ul>

              <p className="mb-2 mt-4"><strong>Enterprise (Custom pricing):</strong></p>
              <ul className="list-disc pl-6">
                <li>Unlimited everything</li>
                <li>Priority support</li>
                <li>Custom integrations</li>
                <li>Whitelabel options</li>
                <li>Dedicated account manager</li>
              </ul>
            </div>

            <h3 className="text-lg font-semibold mb-3">4.3 Payment Terms</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>Subscriptions are billed in advance on a monthly or annual basis</li>
              <li>Annual plans receive a 10% discount</li>
              <li>All fees are exclusive of taxes unless stated otherwise</li>
              <li>Payment processing is handled securely by Stripe</li>
              <li>We accept major credit cards and debit cards</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">4.4 Automatic Renewal</h3>
            <p className="mb-4">
              Subscriptions automatically renew unless cancelled before the renewal date. You will be notified before any price changes take effect.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">5. Cancellation and Refunds</h2>
            
            <h3 className="text-lg font-semibold mb-3">5.1 Cancellation</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>You may cancel your subscription at any time through your account settings</li>
              <li>Cancellation takes effect at the end of the current billing period</li>
              <li>You retain access to paid features until the end of the billing period</li>
              <li>No partial refunds for unused time in the current period</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">5.2 Refund Policy</h3>
            <ul className="list-disc pl-6 mb-4">
              <li>14-day money-back guarantee for first-time subscribers</li>
              <li>No refunds for monthly subscriptions after 14 days</li>
              <li>No refunds for annual subscriptions after 14 days</li>
              <li>Refunds for service issues evaluated case-by-case</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">6. User Content and Conduct</h2>
            
            <h3 className="text-lg font-semibold mb-3">6.1 Your Content</h3>
            <p className="mb-4">
              You retain ownership of content you create using the Service. By using the Service, you grant us a licence to:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Store and process your content to provide the Service</li>
              <li>Publish content to your connected social media accounts as directed</li>
              <li>Generate AI content based on your inputs and preferences</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">6.2 Prohibited Uses</h3>
            <p className="mb-4">You agree not to:</p>
            <ul className="list-disc pl-6 mb-4">
              <li>Violate any laws or regulations</li>
              <li>Post false, misleading, or fraudulent content</li>
              <li>Infringe on intellectual property rights</li>
              <li>Harass, abuse, or harm others</li>
              <li>Spread malware or viruses</li>
              <li>Attempt to gain unauthorised access</li>
              <li>Reverse engineer the Service</li>
              <li>Use the Service for illegal activities</li>
              <li>Resell or redistribute the Service without permission</li>
              <li>Create content that violates social media platform policies</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">6.3 Content Standards</h3>
            <p className="mb-4">
              All content must comply with applicable laws, including advertising standards and alcohol marketing regulations in your jurisdiction.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">7. Intellectual Property</h2>
            
            <h3 className="text-lg font-semibold mb-3">7.1 Our Property</h3>
            <p className="mb-4">
              The Service, including its original content, features, and functionality, is owned by Orange Jelly Limited and is protected by international copyright, trademark, and other intellectual property laws.
            </p>

            <h3 className="text-lg font-semibold mb-3">7.2 Feedback</h3>
            <p className="mb-4">
              Any feedback, suggestions, or ideas you provide about the Service becomes our property and may be used without compensation to you.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">8. Third-Party Services</h2>
            <p className="mb-4">
              The Service integrates with third-party platforms including:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Social media platforms (Facebook, Instagram, etc.)</li>
              <li>OpenAI for content generation</li>
              <li>Stripe for payment processing</li>
              <li>Supabase for data storage</li>
            </ul>
            <p className="mb-4">
              Your use of these third-party services is subject to their respective terms and privacy policies. We are not responsible for third-party services or content.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">9. Disclaimers and Limitations</h2>
            
            <h3 className="text-lg font-semibold mb-3">9.1 Service Availability</h3>
            <p className="mb-4">
              The Service is provided "as is" and "as available" without warranties of any kind. We do not guarantee:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Uninterrupted or error-free service</li>
              <li>Accuracy of AI-generated content</li>
              <li>Success of social media campaigns</li>
              <li>Compatibility with all platforms or devices</li>
            </ul>

            <h3 className="text-lg font-semibold mb-3">9.2 Limitation of Liability</h3>
            <p className="mb-4">
              To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business opportunities.
            </p>
            <p className="mb-4">
              Our total liability shall not exceed the amount paid by you in the 12 months preceding the claim.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">10. Indemnification</h2>
            <p className="mb-4">
              You agree to indemnify and hold harmless CheersAI, Orange Jelly Limited, and their officers, directors, employees, and agents from any claims, damages, losses, or expenses arising from:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Your use of the Service</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of any third-party rights</li>
              <li>Your content or campaigns</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">11. Termination</h2>
            <p className="mb-4">
              We may terminate or suspend your account immediately, without prior notice, for:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Breach of these Terms</li>
              <li>Fraudulent or illegal activity</li>
              <li>Non-payment of fees</li>
              <li>Harmful behaviour towards other users</li>
              <li>At our sole discretion for any reason</li>
            </ul>
            <p className="mb-4">
              Upon termination, your right to use the Service ceases immediately. We may delete your data after 30 days.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">12. Governing Law</h2>
            <p className="mb-4">
              These Terms are governed by the laws of England and Wales. Any disputes shall be resolved in the courts of England and Wales.
            </p>
            <p className="mb-4">
              For EU consumers, this does not affect your statutory rights under local consumer protection laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">13. Changes to Terms</h2>
            <p className="mb-4">
              We reserve the right to modify these Terms at any time. Material changes will be notified via email or platform notification at least 30 days before taking effect.
            </p>
            <p className="mb-4">
              Continued use of the Service after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">14. Severability</h2>
            <p className="mb-4">
              If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in full force and effect.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">15. Entire Agreement</h2>
            <p className="mb-4">
              These Terms, together with our Privacy Policy, constitute the entire agreement between you and CheersAI regarding the use of the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">16. Contact Information</h2>
            <div className="bg-gray-50 p-4 rounded-medium">
              <p className="mb-2"><strong>Service Provider:</strong> Orange Jelly Limited</p>
              <p className="mb-2"><strong>Trading As:</strong> CheersAI</p>
              <p className="mb-2"><strong>Email:</strong> legal@cheersai.com</p>
              <p className="mb-2"><strong>Support:</strong> support@cheersai.com</p>
              <p className="mb-2"><strong>Address:</strong> United Kingdom</p>
              <p className="mb-2"><strong>Company Number:</strong> [To be provided]</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-heading font-bold mb-4">17. Specific Platform Terms</h2>
            
            <h3 className="text-lg font-semibold mb-3">17.1 Facebook and Instagram</h3>
            <p className="mb-4">
              When using Facebook and Instagram features, you agree to comply with Meta's Platform Terms and Community Standards. We are not affiliated with Meta.
            </p>

            <h3 className="text-lg font-semibold mb-3">17.2 AI-Generated Content</h3>
            <p className="mb-4">
              AI-generated content is provided as a suggestion. You are responsible for reviewing, editing, and approving all content before publication. We do not guarantee the accuracy, appropriateness, or success of AI-generated content.
            </p>
          </section>
        </div>
        </Container>
      </main>
    </div>
  );
}
