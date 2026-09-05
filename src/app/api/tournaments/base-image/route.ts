import { NextRequest, NextResponse } from 'next/server';
import { uploadTournamentBaseImage } from '@/app/actions/tournament-images';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Unlike server actions, route handlers need their own same-origin check.
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ success: false, error: 'Upload must come from Cheers.' }, { status: 403 });
  }
  if (Number(request.headers.get('content-length')) > 4 * 1024 * 1024 + 64 * 1024) {
    return NextResponse.json({ success: false, error: 'Images must be 4 MB or smaller.' }, { status: 413 });
  }
  try {
    const result = await uploadTournamentBaseImage(await request.formData());
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Upload failed. Please retry.' }, { status: 400 });
  }
}
