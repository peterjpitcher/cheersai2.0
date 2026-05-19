'use client';

import type { ReactNode } from 'react';

import { useBreakpoint } from '@/hooks/use-breakpoint';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

interface CreateFlowContainerProps {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

/**
 * Responsive container for the create wizard (UX-03, D-01).
 * - Mobile (< 640px): bottom sheet occupying 90vh
 * - Tablet (640-1023px): slide-over panel from the right
 * - Desktop (>= 1024px): centered modal dialog
 *
 * Focus trap and Escape-to-close are handled by Radix Dialog/Sheet (UX-08).
 */
export function CreateFlowContainer({
  children,
  open,
  onOpenChange,
  title = 'Create Content',
}: CreateFlowContainerProps): React.JSX.Element {
  const { isMobile, isTablet } = useBreakpoint();

  // Mobile: bottom sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">
              Create and configure new content
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  // Tablet: slide-over from right
  if (isTablet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">
              Create and configure new content
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: centered modal
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Create and configure new content
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
