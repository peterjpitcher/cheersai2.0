import type { ReadonlyURLSearchParams } from 'next/navigation';

import { CreatePageClient } from '@/features/create/create-page-client';
import { PageHeader } from '@/components/layout/PageHeader';

type SearchParamsLike = ReadonlyURLSearchParams | Record<string, string | string[] | undefined>;

interface CreatePageProps {
  searchParams?: Promise<SearchParamsLike>;
}

/**
 * /create route — opens the 4-step create wizard.
 * Supports ?draft=<uuid> query param to resume an existing draft.
 */
export default async function CreatePage({ searchParams }: CreatePageProps): Promise<React.JSX.Element> {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const draft = resolveQueryParam(resolvedParams, 'draft');

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Create"
        description="Launch instant posts, story drops, event and promo campaigns, or recurring weekly content."
      />

      <CreatePageClient initialDraftId={draft} />
    </div>
  );
}

function resolveQueryParam(params: SearchParamsLike | undefined, key: string): string | undefined {
  if (!params) return undefined;

  if (isUrlSearchParams(params)) {
    const value = params.get(key);
    return value?.trim() ? value.trim() : undefined;
  }

  const raw = params[key];
  if (Array.isArray(raw)) {
    const first = raw.find((entry) => typeof entry === 'string' && entry.trim().length);
    return first ? first.trim() : undefined;
  }

  if (typeof raw === 'string' && raw.trim().length) {
    return raw.trim();
  }

  return undefined;
}

function isUrlSearchParams(value: SearchParamsLike): value is ReadonlyURLSearchParams {
  return typeof (value as ReadonlyURLSearchParams).get === 'function';
}
