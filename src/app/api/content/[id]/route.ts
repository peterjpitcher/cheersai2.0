import { NextRequest, NextResponse } from 'next/server';

import { getPlannerContentDetail } from '@/lib/planner/data';

function isNextRedirectError(error: unknown): error is { digest: string } {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const content = await getPlannerContentDetail(id);

    if (!content) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(content);
  } catch (error) {
    if (isNextRedirectError(error)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[api] content detail fetch failed', error);
    return NextResponse.json(
      { error: 'Failed to load content' },
      { status: 500 },
    );
  }
}
