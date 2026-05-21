'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CreateFlowContainer } from '@/features/create/create-flow-container';
import { CreateWizard } from '@/features/create/create-wizard';
import { useAuth } from '@/components/providers/auth-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatePageClientProps {
  initialDraftId?: string;
  /** Accepted for backward compatibility with ?flow= links; the wizard's
   * Brief step is where the content type is chosen, so it is not used here. */
  initialFlow?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client shell for the /create page.
 *
 * Opens the create wizard directly. There is no separate launcher screen —
 * the wizard's first step (Brief) is where the content type is chosen, so a
 * preceding "what are we making?" grid would just ask the same question twice.
 */
export function CreatePageClient({ initialDraftId }: CreatePageClientProps): React.JSX.Element {
  const router = useRouter();
  const user = useAuth();
  const [wizardOpen, setWizardOpen] = useState(true);

  // The launcher is gone, so closing/cancelling returns to the planner —
  // which is also where freshly scheduled posts appear.
  const handleWizardClose = useCallback(() => {
    setWizardOpen(false);
    router.push('/planner');
  }, [router]);

  return (
    <CreateFlowContainer open={wizardOpen} onOpenChange={setWizardOpen} title="Create Content">
      <CreateWizard
        initialDraftId={initialDraftId}
        accountId={user?.accountId ?? ''}
        onClose={handleWizardClose}
      />
    </CreateFlowContainer>
  );
}
