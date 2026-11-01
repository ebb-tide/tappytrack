import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { upstreamJson } from '@/lib/upstream';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userid = session?.user?.id;
  const headers = { 'Cache-Control': 'no-store' };
  if (!userid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2 || q.length > 120) {
    return NextResponse.json({ error: 'Enter between 2 and 120 characters to search.' }, { status: 400, headers });
  }
  try {
    const params = new URLSearchParams({ userid, q });
    const response = await fetch(`${process.env.LAMBDA_URL}/search?${params}`, {
      headers: { 'x-internal': process.env.LAMBDA_SECRET || '' },
      cache: 'no-store',
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(6000)]),
    });
    return NextResponse.json(await upstreamJson(response), { status: response.status, headers });
  } catch {
    return NextResponse.json({ error: 'Could not search Spotify. Please try again.' }, { status: 502, headers });
  }
}
