import Link from 'next/link';
import { Home, Search, ArrowLeft, Beer } from 'lucide-react';
import Logo from '@/components/ui/logo';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center">
        <div className="mb-8">
          <div className="flex justify-center mb-8">
            <Logo variant="full" />
          </div>
          
          <div className="flex justify-center mb-6">
            <div className="bg-primary/10 p-6 rounded-full">
              <Beer className="w-16 h-16 text-primary" />
            </div>
          </div>
          
          <h1 className="text-6xl font-heading font-bold text-primary mb-4">404</h1>
          
          <h2 className="text-2xl font-heading font-bold text-text-primary mb-2">
            Looks like you&apos;re lost!
          </h2>
          
          <p className="text-text-secondary mb-8">
            The page you&apos;re looking for has gone to the pub and hasn&apos;t come back yet.
          </p>
        </div>
        
        <div className="card">
          <p className="text-sm text-text-secondary mb-6">
            Let&apos;s get you back on track:
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/" className="btn-primary">
              <Home className="w-4 h-4" />
              Go Home
            </Link>
            
            <Link href="/dashboard" className="btn-secondary">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Link>
            
            <Link href="/campaigns" className="btn-ghost">
              <Search className="w-4 h-4" />
              Campaigns
            </Link>
          </div>
        </div>
        
        <div className="mt-8 text-sm text-text-secondary">
          <p>
            If you think this is a mistake, please{' '}
            <a href="mailto:support@cheersai.orangejelly.co.uk" className="text-primary hover:underline">
              contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}