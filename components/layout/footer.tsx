import Link from 'next/link';
import Logo from '@/components/ui/logo';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="container mx-auto max-w-screen-2xl px-4 py-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <Logo variant="icon" />
            <p className="text-sm text-text-secondary">© {currentYear} <a href="https://www.orangejelly.co.uk" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">Orange Jelly Limited</a></p>
          </div>
          
          {/* Navigation */}
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/features" className="text-sm text-text-secondary transition-colors hover:text-primary">
              Features
            </Link>
            <Link href="/pricing" className="text-sm text-text-secondary transition-colors hover:text-primary">
              Pricing
            </Link>
            <Link href="/terms" className="text-sm text-text-secondary transition-colors hover:text-primary">
              Terms
            </Link>
            <Link href="/privacy" className="text-sm text-text-secondary transition-colors hover:text-primary">
              Privacy
            </Link>
            <Link href="/help" className="text-sm text-text-secondary transition-colors hover:text-primary">
              Get Help
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
