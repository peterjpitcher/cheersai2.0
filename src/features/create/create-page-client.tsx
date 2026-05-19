'use client';

import { useState } from 'react';

import { CreateFlowContainer } from '@/features/create/create-flow-container';
import { CreateWizard } from '@/features/create/create-wizard';

interface CreatePageClientProps {
  initialDraftId?: string;
}

/**
 * Client shell for the /create page.
 * Wraps the wizard in the responsive CreateFlowContainer.
 * The page opens with the wizard visible by default.
 */
export function CreatePageClient({ initialDraftId }: CreatePageClientProps): React.JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <CreateFlowContainer open={open} onOpenChange={setOpen} title="Create Content">
      <CreateWizard
        initialDraftId={initialDraftId}
        onClose={() => setOpen(false)}
      />
    </CreateFlowContainer>
  );
}
