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
    <html>
      <body>
        <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            <Card className="p-8">
              <CardContent className="p-0">
              <div className="flex justify-center mb-6">
                <div className="bg-error/10 p-4 rounded-full">
                  <AlertTriangle className="w-12 h-12 text-error" />
                </div>
              </div>
              
              <h1 className="text-3xl font-heading font-bold text-text-primary mb-2">
                Oops! Something went wrong
              </h1>
              
              <p className="text-text-secondary mb-6">
                We&apos;re sorry, but something unexpected happened. Our team has been notified and is working on it.
              </p>
              
              {error.digest && (
                <p className="text-xs text-text-secondary/60 mb-6">
                  Error ID: {error.digest}
                </p>
              )}
              
              <div className="flex gap-3 justify-center">
                <Button onClick={reset}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
                <Link href="/">
                  <Button variant="secondary">
                    <Home className="w-4 h-4 mr-2" />
                    Go Home
                  </Button>
                </Link>
              </div>
              
              <div className="mt-8 p-4 bg-gray-50 rounded-medium">
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
