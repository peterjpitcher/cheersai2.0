'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

function TeamInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    handleInvite();
  }, []);

  const handleInvite = async () => {
    const token = searchParams.get('token');
    
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing invitation token');
      return;
    }

    try {
      const response = await fetch('/api/team/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const result = await response.json();

      if (result.success) {
        setStatus('success');
        setMessage(result.message || 'Successfully joined the team!');
        setTeamName(result.teamName || '');
        
        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
          router.push('/dashboard');
        }, 3000);
      } else {
        setStatus('error');
        setMessage(result.error || 'Failed to accept invitation');
      }
    } catch (error) {
      setStatus('error');
      setMessage('An error occurred while accepting the invitation');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        {status === 'loading' && (
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 animate-spin" size={48} />
            <h2 className="text-xl font-semibold mb-2">Processing Invitation</h2>
            <p className="text-gray-600">
              Please wait while we verify your invitation...
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <CheckCircle className="mx-auto mb-4 text-green-500" size={48} />
            <h2 className="text-xl font-semibold mb-2">Welcome to the Team!</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            {teamName && (
              <p className="text-lg font-medium mb-4">
                You&apos;ve joined <span className="text-blue-600">{teamName}</span>
              </p>
            )}
            <p className="text-sm text-gray-500">
              Redirecting to dashboard...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <XCircle className="mx-auto mb-4 text-red-500" size={48} />
            <h2 className="text-xl font-semibold mb-2">Invitation Error</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <div className="space-y-3">
              <Button
                onClick={() => router.push('/auth/login')}
                className="w-full"
              >
                Go to Login
              </Button>
              <Button
                onClick={() => router.push('/auth/signup')}
                variant="outline"
                className="w-full"
              >
                Create Account
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function TeamInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>}>
      <TeamInviteContent />
    </Suspense>
  );
}