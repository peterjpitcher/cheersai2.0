import type { ReadonlyURLSearchParams } from 'next/navigation';

import { CreatePageClient } from '@/features/create/create-page-client';

type SearchParamsLike = ReadonlyURLSearchParams | Record<string, string | string[] | undefined>;

interface CreatePageProps {
  searchParams?: Promise<SearchParamsLike>;
}

/**
 * /create route — launcher grid for choosing a create flow.
 * Supports ?flow=instant|event|promotion|weekly to jump straight into a form.
 * Supports ?draft=<uuid> to resume an existing draft.
 */
export default async function CreatePage({ searchParams }: CreatePageProps): Promise<React.JSX.Element> {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const draft = resolveQueryParam(resolvedParams, 'draft');
  const flow = resolveQueryParam(resolvedParams, 'flow');

  return (
    <div className="w-full py-8">
      <CreatePageClient initialDraftId={draft} initialFlow={flow} />
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
