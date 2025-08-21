import Link from 'next/link';
import Logo from '@/components/ui/logo';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="border-t border-border bg-surface mt-auto">
      <div className="container mx-auto px-4 py-6 max-w-screen-2xl">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <Logo variant="icon" />
            <p className="text-sm text-text-secondary">© {currentYear} Orange Jelly Limited</p>
          </div>
          
          {/* Navigation */}
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/terms" className="text-sm text-text-secondary hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="text-sm text-text-secondary hover:text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/help" className="text-sm text-text-secondary hover:text-primary transition-colors">
              Get Help
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}