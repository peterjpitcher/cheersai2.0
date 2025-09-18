import Link from 'next/link';
import { Home, Search, ArrowLeft, Beer } from 'lucide-react';
import BrandLogo from '@/components/ui/BrandLogo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
      <div className="w-full max-w-lg text-center">
        <div className="mb-8">
          <div className="mb-8 flex justify-center">
            <BrandLogo variant="auth" />
          </div>
          
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-primary/10 p-6">
              <Beer className="size-16 text-primary" />
            </div>
          </div>
          
          <h1 className="mb-4 font-heading text-6xl font-bold text-primary">404</h1>
          
          <h2 className="mb-2 font-heading text-2xl font-bold text-text-primary">
            Looks like you&apos;re lost!
          </h2>
          
          <p className="mb-8 text-text-secondary">
            The page you&apos;re looking for has gone to the pub and hasn&apos;t come back yet.
          </p>
        </div>
        
        <Card>
          <CardContent className="pt-6">
            <p className="mb-6 text-sm text-text-secondary">
              Let&apos;s get you back on track:
            </p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/">
                <Button>
                  <Home className="mr-2 size-4" />
                  Go Home
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="secondary">
                  <ArrowLeft className="mr-2 size-4" />
                  Dashboard
                </Button>
              </Link>
              <Link href="/campaigns">
                <Button variant="ghost">
                  <Search className="mr-2 size-4" />
                  Campaigns
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
        
        <div className="mt-8 text-sm text-text-secondary">
          <p>
            {(() => {
              const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@cheersai.uk'
              return (
                <>
                  If you think this is a mistake, please{' '}
                  <a href={`mailto:${email}`} className="text-primary hover:underline">
                    contact support
                  </a>
                </>
              )
            })()}
          </p>
        </div>
      </div>
    </div>
  );
}
