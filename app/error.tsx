'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, Home, RefreshCw } from 'lucide-react';
import Logo from '@/components/ui/logo';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card className="text-center">
          <CardContent className="pt-6">
          <div className="mb-8 flex justify-center">
            <Logo variant="full" />
          </div>
          
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-warning/10 p-4">
              <AlertCircle className="size-12 text-warning" />
            </div>
          </div>
          
          <h1 className="mb-2 font-heading text-2xl font-bold text-text-primary">
            Something went wrong!
          </h1>
          
          <p className="mb-6 text-text-secondary">
            Don&apos;t worry, we&apos;ve logged this error and will look into it.
          </p>
          
          <div className="flex justify-center gap-3">
            <Button onClick={reset}>
              <RefreshCw className="mr-2 size-4" />
              Try Again
            </Button>
            <Link href="/dashboard">
              <Button variant="secondary">
                <Home className="mr-2 size-4" />
                Dashboard
              </Button>
            </Link>
          </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
