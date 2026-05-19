'use client';

import type { ReactNode } from 'react';

interface CreateFlowContainerProps {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

/**
 * Container for the create flow content.
 *
 * In the redesign this renders inline on the page (no modal/sheet).
 * The open/onOpenChange props are kept for backward compatibility with
 * the wizard's close behaviour — when open becomes false, the parent
 * routes back to the launcher.
 */
export function CreateFlowContainer({
  children,
  open,
}: CreateFlowContainerProps): React.JSX.Element {
  if (!open) return <></>;

  return (
    <div style={{ width: '100%' }}>
      {children}
    </div>
  );
}
