'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, Home, RefreshCw } from 'lucide-react';
import Logo from '@/components/ui/logo';

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="card text-center">
          <div className="flex justify-center mb-8">
            <Logo variant="full" />
          </div>
          
          <div className="flex justify-center mb-6">
            <div className="bg-warning/10 p-4 rounded-full">
              <AlertCircle className="w-12 h-12 text-warning" />
            </div>
          </div>
          
          <h1 className="text-2xl font-heading font-bold text-text-primary mb-2">
            Something went wrong!
          </h1>
          
          <p className="text-text-secondary mb-6">
            Don&apos;t worry, we&apos;ve logged this error and will look into it.
          </p>
          
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="btn-primary"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            
            <Link href="/dashboard" className="btn-secondary">
              <Home className="w-4 h-4" />
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}