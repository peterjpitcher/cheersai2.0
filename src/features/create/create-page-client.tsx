'use client';

import { useState } from 'react';

import { CreateFlowContainer } from '@/features/create/create-flow-container';
import { CreateWizard } from '@/features/create/create-wizard';
import { useAuth } from '@/components/providers/auth-provider';

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
  const user = useAuth();

  return (
    <CreateFlowContainer open={open} onOpenChange={setOpen} title="Create Content">
      <CreateWizard
        initialDraftId={initialDraftId}
        accountId={user?.accountId ?? ''}
        onClose={() => setOpen(false)}
      />
    </CreateFlowContainer>
  );
}
