'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Calendar, Info, Megaphone, RefreshCw, Sparkles } from 'lucide-react';

import { CreateFlowContainer } from '@/features/create/create-flow-container';
import { CreateWizard } from '@/features/create/create-wizard';
import { useAuth } from '@/components/providers/auth-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowType = 'instant' | 'event' | 'promotion' | 'weekly';

interface CreatePageClientProps {
  initialDraftId?: string;
  initialFlow?: string;
}

// ---------------------------------------------------------------------------
// Tile data
// ---------------------------------------------------------------------------

const TILES: Array<{
  flow: FlowType;
  icon: typeof Sparkles;
  title: string;
  description: string;
  meta: string;
}> = [
  {
    flow: 'instant',
    icon: Sparkles,
    title: 'Instant post',
    description: 'One brief → drafts for every platform. Publish now or schedule.',
    meta: 'Typical: 2–3 min',
  },
  {
    flow: 'event',
    icon: Calendar,
    title: 'Event campaign',
    description: 'Build-up + day-of + last-call posts spaced around an event date.',
    meta: 'Generates 4–6 posts',
  },
  {
    flow: 'promotion',
    icon: Megaphone,
    title: 'Promotion',
    description: 'A time-limited offer with announcement, mid-run, and last-chance posts.',
    meta: 'Generates 3–5 posts',
  },
  {
    flow: 'weekly',
    icon: RefreshCw,
    title: 'Weekly recurring',
    description: 'Thursday quiz, Sunday roast — set it once, write every week.',
    meta: 'Auto-posts forever',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client shell for the /create page.
 *
 * When no ?flow= or ?draft= param exists, shows a 2x2 launcher grid.
 * When a flow is selected (via tile click or URL param), shows the
 * appropriate wizard/form inside the existing CreateFlowContainer.
 */
export function CreatePageClient({ initialDraftId, initialFlow }: CreatePageClientProps): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth();

  // Derive active flow from URL params
  const activeFlow = (initialFlow ?? searchParams.get('flow') ?? undefined) as FlowType | undefined;
  const hasDraft = Boolean(initialDraftId ?? searchParams.get('draft'));

  // For the wizard container open state
  const [wizardOpen, setWizardOpen] = useState(true);

  const handleFlowSelect = useCallback(
    (flow: FlowType) => {
      router.push(`/create?flow=${flow}`);
    },
    [router],
  );

  const handleWizardClose = useCallback(() => {
    setWizardOpen(false);
    router.push('/create');
  }, [router]);

  // If a flow is selected or a draft is being resumed, show the wizard/form
  if (activeFlow || hasDraft) {
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

  // Otherwise, show the launcher grid
  return <CreateLauncher onSelect={handleFlowSelect} />;
}

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

function CreateLauncher({ onSelect }: { onSelect: (flow: FlowType) => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="eyebrow">Create</p>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--c-ink)',
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          What are <span style={{ color: 'var(--c-orange)' }}>we</span> making?
        </h1>
        <p
          style={{
            fontSize: 15,
            color: 'var(--c-ink-2)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Four shapes of work. Pick whichever fits &mdash; you can always change your mind.
        </p>
      </div>

      {/* Responsive launcher grid: 1 col on mobile, 2 cols on sm+ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[14px]">

        {TILES.map((tile) => (
          <LauncherTile
            key={tile.flow}
            icon={tile.icon}
            title={tile.title}
            description={tile.description}
            meta={tile.meta}
            onClick={() => onSelect(tile.flow)}
          />
        ))}
      </div>

      {/* Help hint */}
      <div
        style={{
          backgroundColor: 'var(--c-paper-2)',
          border: '1px solid var(--c-line)',
          borderRadius: 14,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <Info
          style={{
            width: 16,
            height: 16,
            color: 'var(--c-ink-3)',
            flexShrink: 0,
            marginTop: 1,
          }}
        />
        <p
          style={{
            fontSize: 14,
            color: 'var(--c-ink-2)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Not sure? <strong>Instant post</strong> is the right call 9 times out of 10.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

interface LauncherTileProps {
  icon: typeof Sparkles;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
}

function LauncherTile({ icon: Icon, title, description, meta, onClick }: LauncherTileProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: 24,
        borderRadius: 16,
        backgroundColor: 'var(--c-card)',
        border: '1px solid var(--c-line)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        transition: 'all 150ms ease',
      }}
      className="create-launcher-tile"
    >
      {/* Icon block */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: 'var(--c-orange-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon style={{ width: 22, height: 22, color: 'var(--c-orange)' }} />
      </div>

      {/* Text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--c-ink)',
            margin: 0,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 14,
            color: 'var(--c-ink-2)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      </div>

      {/* Meta */}
      <p className="eyebrow" style={{ margin: 0, marginTop: 'auto' }}>
        {meta}
      </p>
    </button>
  );
}
