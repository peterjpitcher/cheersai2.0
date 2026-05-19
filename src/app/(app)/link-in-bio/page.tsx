import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LinkInBioEditor } from '@/features/link-in-bio/editor/link-in-bio-editor';

export const metadata: Metadata = {
  title: 'Link-in-Bio | CheersAI',
};

function EditorSkeleton() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export default function LinkInBioPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <Suspense fallback={<EditorSkeleton />}>
        <LinkInBioEditor />
      </Suspense>
    </div>
  );
}
