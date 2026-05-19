"use client";

import { Loader2 } from "lucide-react";

interface GenerationProgressProps {
  active: boolean;
  value: number;
  message: string;
}

export function GenerationProgress({ active, value, message }: GenerationProgressProps) {
  if (!active) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 14,
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-paper-2)',
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader2
          className="animate-spin"
          style={{ width: 14, height: 14, color: 'var(--c-orange)', flexShrink: 0 }}
          aria-hidden="true"
        />
        <p
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--c-ink)',
            margin: 0,
          }}
        >
          {message}
        </p>
      </div>
      <div
        style={{
          height: 4,
          width: '100%',
          overflow: 'hidden',
          borderRadius: 2,
          backgroundColor: 'var(--c-line)',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            backgroundColor: 'var(--c-orange)',
            transition: 'width 300ms ease',
            width: `${Math.min(Math.max(value, 5), 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
