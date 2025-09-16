"use client";

import * as React from "react";
import BaseEmptyState from "@/components/ui/empty-state";

type EmptyStateProps = React.ComponentProps<typeof BaseEmptyState> & {
  role?: 'status' | 'region';
  ariaLabel?: string;
};

export function EmptyState({ role = 'region', ariaLabel = 'Empty state', ...props }: EmptyStateProps) {
  return (
    <div role={role} aria-label={ariaLabel}>
      <BaseEmptyState {...props} />
    </div>
  );
}

