import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="border-t border-border bg-surface mt-auto">
      <div className="container mx-auto px-4 py-4 max-w-screen-2xl">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-text-secondary">
          <p>© {currentYear} Orange Jelly Limited</p>
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/help" className="hover:text-primary transition-colors">
              Get Help
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}