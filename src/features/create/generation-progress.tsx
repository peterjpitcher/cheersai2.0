"use client";

interface GenerationProgressProps {
  active: boolean;
  value: number;
  message: string;
}

export function GenerationProgress({ active, value, message }: GenerationProgressProps) {
  if (!active) return null;

  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-700">{message}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-900 transition-all"
          style={{ width: `${Math.min(Math.max(value, 5), 100)}%` }}
        />
      </div>
    </div>
  );
}
