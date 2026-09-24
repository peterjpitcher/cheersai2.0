import Image from 'next/image';
import type { ReactNode } from 'react';

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * Centred single-column card for the smaller auth pages (set password,
 * forgot password). The login page keeps its own split-screen layout.
 */
export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div
      className="flex min-h-svh items-center justify-center px-4 py-12 sm:px-6"
      style={{ backgroundColor: 'var(--c-card)' }}
    >
      <div className="w-full max-w-[400px] space-y-8">
        <div className="flex items-center justify-center">
          <Image src="/brand/cheers-logo-horizontal-480.png" alt="Cheers by Orange Jelly" width={140} height={48} priority />
        </div>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
            {title}
          </h1>
          <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
            {description}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthMessage({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const style =
    tone === 'error'
      ? { backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }
      : { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="rounded-[var(--r-md)] p-3 text-center text-sm font-medium" style={style}>
      {children}
    </div>
  );
}
