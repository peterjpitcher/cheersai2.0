'use client';

import { AlertTriangle } from 'lucide-react';

export function PreconditionWarning({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;

  return (
    <div
      className="p-4 mb-6"
      style={{
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--c-orange-soft)',
        backgroundColor: 'var(--c-orange-tint)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="h-5 w-5 mt-0.5 shrink-0"
          style={{ color: 'var(--c-orange)' }}
        />
        <div>
          <h3
            className="text-sm font-medium"
            style={{ color: 'var(--c-orange-hi)' }}
          >
            Content generation is disabled
          </h3>
          <ul
            className="mt-2 text-sm list-disc list-inside space-y-1"
            style={{ color: 'var(--c-orange-hi)' }}
          >
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
