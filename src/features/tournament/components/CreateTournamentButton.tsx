'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CreateTournamentModal } from './CreateTournamentModal';

export function CreateTournamentButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors"
        style={{
          backgroundColor: 'var(--c-orange)',
          borderRadius: 'var(--r-md)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-orange-hi)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-orange)')}
      >
        <Plus className="h-4 w-4" />
        New Tournament
      </button>
      <CreateTournamentModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
