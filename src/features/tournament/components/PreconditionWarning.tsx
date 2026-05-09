'use client';

import { AlertTriangle } from 'lucide-react';

export function PreconditionWarning({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-medium text-amber-800">
            Content generation is disabled
          </h3>
          <ul className="mt-2 text-sm text-amber-700 list-disc list-inside space-y-1">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
