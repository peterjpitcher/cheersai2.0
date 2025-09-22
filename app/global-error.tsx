'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global error:', error);
    
    // In production, send to error tracking service like Sentry
    if (process.env.NODE_ENV === 'production') {
      // Example: Sentry.captureException(error);
    }
  }, [error]);

  return (
    <html lang="en-GB">
      <body>
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
          <div className="w-full max-w-md text-center">
            <Card className="p-8">
              <CardContent className="p-0">
              <div className="mb-6 flex justify-center">
                <div className="rounded-full bg-error/10 p-4">
                  <AlertTriangle className="size-12 text-error" />
                </div>
              </div>
              
              <h1 className="mb-2 font-heading text-3xl font-bold text-text-primary">
                Oops! Something went wrong
              </h1>
              
              <p className="mb-6 text-text-secondary">
                We&apos;re sorry, but something unexpected happened. Our team has been notified and is working on it.
              </p>
              
              {error.digest && (
                <p className="mb-6 text-xs text-text-secondary/60">
                  Error ID: {error.digest}
                </p>
              )}
              
              <div className="flex justify-center gap-3">
                <Button onClick={reset}>
                  <RefreshCw className="mr-2 size-4" />
                  Try Again
                </Button>
                <Link href="/">
                  <Button variant="secondary">
                    <Home className="mr-2 size-4" />
                    Go Home
                  </Button>
                </Link>
              </div>
              
              <div className="mt-8 rounded-medium bg-gray-50 p-4">
                <p className="text-sm text-text-secondary">
                  {(() => {
                    const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@cheersai.uk'
                    return (
                      <>
                        If this problem persists, please contact support at{' '}
                        <a href={`mailto:${email}`} className="text-primary hover:underline">
                          {email}
                        </a>
                      </>
                    )
                  })()}
                </p>
              </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </body>
    </html>
  );
}
